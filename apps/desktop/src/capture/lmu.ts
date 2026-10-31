import type { SimId } from "@overlay/sim-core";
import { RecordKind } from "@overlay/sim-core";
import {
  LMU_NAVIGATION_PATH,
  LMU_REST_POLL_PATHS,
  LMU_SWAGGER_PATH,
  RestRequestRejected,
  type LmuRestClient,
  type RestResult,
} from "./rest-client";
import type { RecordSink, SimCapture } from "./sim-capture";
import { STALE_CLOSE_MS } from "./sim-capture";
import { copyConsistent, type Clock, type SharedMapping, type SharedMemorySource } from "./shm";

export * from "./lmu-names";
import {
  LMU_MAX_COPY_ATTEMPTS,
  LMU_DATA_NAME,
  LMU_DATA_EVENT_NAME,
  LMU_LOCK_DATA_NAME,
  LMU_LOCK_EVENT_NAME,
  LMU_LIVE_WINDOW_MS,
} from "./lmu-names";

export const LMU_BURST_FRAMES = 1000;
export const LMU_REST_INTERVAL_MS = 1000;
export const LMU_DEFAULT_HZ = 5;
const LOCK_BYTES = 8;

export interface LockState {
  waiters: number;
  busy: number;
  raw: string;
}

export class LmuCapture implements SimCapture {
  readonly sim: SimId = "lmu";
  frames = 0;
  inconsistentFrames = 0;
  restResponses = 0;
  burstFrames = 0;
  hz = LMU_DEFAULT_HZ;

  private data: SharedMapping | undefined;
  private lock: SharedMapping | undefined;
  private sink: RecordSink | undefined;
  private copyA = Buffer.alloc(0);
  private copyB = Buffer.alloc(0);
  private previous = Buffer.alloc(0);
  private hasPrevious = false;
  private readonly lockBuf = Buffer.alloc(LOCK_BYTES);
  private lastChangeMono = Number.NEGATIVE_INFINITY;
  private lastRestOkMono = Number.NEGATIVE_INFINITY;
  private lastSeenMono = Number.NEGATIVE_INFINITY;
  private nextFrameAt = 0;
  private nextRestAt = 0;
  private burstRemaining = 0;
  private restIndex = 0;
  private swaggerPending = false;
  private stampedBuild: string | undefined;
  private lastNav: unknown;
  private inFlight: Promise<void> | undefined;
  private generation = 0;
  private mappingInfo: Record<string, unknown> = {};

  constructor(
    private readonly source: SharedMemorySource,
    private readonly rest: LmuRestClient,
    private readonly clock: Clock,
  ) {}

  get isOpen(): boolean {
    return this.data !== undefined;
  }

  get live(): boolean {
    if (!this.data) return false;
    const now = this.clock.monoMs();
    return now - Math.max(this.lastChangeMono, this.lastRestOkMono) <= LMU_LIVE_WINDOW_MS;
  }

  headerExtras(): Record<string, unknown> {
    return { lmuMappings: this.mappingInfo, lmuRestBase: "http://127.0.0.1:6397" };
  }

  /** Resolves when the in-flight REST request, if any, has finished. */
  settled(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  async probe(capturing: boolean): Promise<void> {
    const now = this.clock.monoMs();
    if (!this.data) this.open(now);
    if (!this.data) return;
    // While capturing and live, step supplies the signals. Once not live (a load screen, say)
    // keep probing, so the file continues when the sim comes back instead of splitting.
    if (!capturing || !this.live) {
      // One copy compared with the previous one, one heartbeat request.
      this.copyInto(this.copyA);
      this.noteBuffer(this.copyA, now);
      if (!this.inFlight)
        this.inFlight = this.heartbeat().finally(() => (this.inFlight = undefined));
      await this.inFlight;
    }
    if (!this.live && now - this.lastSeenMono > STALE_CLOSE_MS) this.close();
  }

  async beginFile(sink: RecordSink): Promise<void> {
    this.sink = sink;
    this.generation++;
    this.frames = 0;
    this.inconsistentFrames = 0;
    this.restResponses = 0;
    this.burstFrames = 0;
    this.burstRemaining = LMU_BURST_FRAMES;
    this.nextFrameAt = 0;
    this.nextRestAt = 0;
    this.swaggerPending = true;
    this.stampedBuild = undefined;
    if (this.lastNav !== undefined) await this.stampGameInfo(sink, this.lastNav);
  }

  onMarker(): void {
    this.burstRemaining = LMU_BURST_FRAMES;
  }

  async step(): Promise<void> {
    const sink = this.sink;
    if (!sink || !this.data || !this.live) return;
    const now = this.clock.monoMs();

    if (!this.inFlight && now >= this.nextRestAt) {
      this.nextRestAt = now + LMU_REST_INTERVAL_MS;
      this.inFlight = this.pollRest(sink, this.generation).finally(
        () => (this.inFlight = undefined),
      );
    }

    if (this.burstRemaining > 0) {
      await this.captureFrame(sink, true);
      this.burstRemaining--;
    } else if (now >= this.nextFrameAt) {
      this.nextFrameAt = now + 1000 / Math.max(this.hz, 0.1);
      await this.captureFrame(sink, false);
    }
  }

  async endFile(): Promise<Record<string, unknown>> {
    this.sink = undefined;
    this.generation++;
    await this.inFlight;
    return {
      frames: this.frames,
      burstFrames: this.burstFrames,
      inconsistentFrames: this.inconsistentFrames,
      restResponses: this.restResponses,
    };
  }

  close(): void {
    this.data?.close();
    this.lock?.close();
    this.data = undefined;
    this.lock = undefined;
  }

  private open(now: number): void {
    const data = this.source.openMapping(LMU_DATA_NAME);
    if (!data) return;
    this.data = data;
    this.lock = this.source.openMapping(LMU_LOCK_DATA_NAME);
    // Record which objects exist; the events are opened only to learn that, then released.
    const dataEvent = this.source.openEvent(LMU_DATA_EVENT_NAME);
    const lockEvent = this.source.openEvent(LMU_LOCK_EVENT_NAME);
    this.mappingInfo = {
      [LMU_DATA_NAME]: { opened: true, size: data.size },
      [LMU_LOCK_DATA_NAME]: { opened: this.lock !== undefined, size: this.lock?.size ?? 0 },
      [LMU_DATA_EVENT_NAME]: { opened: dataEvent !== undefined },
      [LMU_LOCK_EVENT_NAME]: { opened: lockEvent !== undefined },
    };
    dataEvent?.close();
    lockEvent?.close();
    this.copyA = Buffer.alloc(data.size);
    this.copyB = Buffer.alloc(data.size);
    this.previous = Buffer.alloc(data.size);
    this.hasPrevious = false;
    this.lastSeenMono = now;
    this.lastChangeMono = Number.NEGATIVE_INFINITY;
    this.lastRestOkMono = Number.NEGATIVE_INFINITY;
  }

  private copyInto(dst: Buffer): void {
    this.data?.copy(dst, 0, dst.length);
  }

  /** Tracks whether the buffer moves; an unchanged buffer means menu, pause or a dead game. */
  private noteBuffer(frame: Buffer, now: number): void {
    if (this.hasPrevious && !frame.equals(this.previous)) {
      this.lastChangeMono = now;
      this.lastSeenMono = now;
    }
    frame.copy(this.previous);
    this.hasPrevious = true;
  }

  /** Reads the lock state without taking the lock: a read-only view of {waiters, busy}. */
  private readLock(): LockState | null {
    if (!this.lock) return null;
    this.lock.copy(this.lockBuf, 0, Math.min(LOCK_BYTES, this.lock.size));
    return {
      waiters: this.lockBuf.readUInt32LE(0),
      busy: this.lockBuf.readUInt32LE(4),
      raw: this.lockBuf.toString("hex"),
    };
  }

  private async captureFrame(sink: RecordSink, burst: boolean): Promise<void> {
    const lockBefore = this.readLock();
    const { consistent, attempts } = copyConsistent(
      this.data,
      this.copyA,
      this.copyB,
      LMU_MAX_COPY_ATTEMPTS,
    );
    const lockAfter = this.readLock();
    const now = this.clock.monoMs();
    this.noteBuffer(this.copyB, now);
    this.frames++;
    if (burst) this.burstFrames++;
    if (!consistent) this.inconsistentFrames++;
    await sink.write(RecordKind.LmuSync, {
      frame: this.frames,
      burst,
      consistent,
      attempts,
      lockBefore,
      lockAfter,
    });
    await sink.write(RecordKind.LmuBuffer, this.copyB);
  }

  private async heartbeat(): Promise<void> {
    const result = await this.safeGet(LMU_NAVIGATION_PATH);
    if (result) this.noteRest(result);
  }

  private noteRest(result: RestResult): void {
    if (result.path !== LMU_NAVIGATION_PATH || result.status !== 200) return;
    const now = this.clock.monoMs();
    this.lastRestOkMono = now;
    this.lastSeenMono = now;
    this.lastNav = result.body;
  }

  private async safeGet(path: string): Promise<RestResult | undefined> {
    try {
      return await this.rest.get(path);
    } catch (error) {
      if (error instanceof RestRequestRejected) return undefined;
      throw error;
    }
  }

  /** One request per call, one at a time; navigation/state every other slot keeps liveness fresh. */
  private async pollRest(sink: RecordSink, generation: number): Promise<void> {
    let path: string;
    if (this.swaggerPending) {
      this.swaggerPending = false;
      path = LMU_SWAGGER_PATH;
    } else {
      const slot = this.restIndex++;
      path =
        slot % 2 === 0
          ? LMU_NAVIGATION_PATH
          : (LMU_REST_POLL_PATHS[Math.floor(slot / 2) % LMU_REST_POLL_PATHS.length] ??
            LMU_NAVIGATION_PATH);
    }
    const result = await this.safeGet(path);
    if (!result) return;
    this.noteRest(result);
    if (generation !== this.generation) return; // the file was closed or rotated meanwhile
    try {
      await sink.write(RecordKind.RestResponse, result);
      this.restResponses++;
      if (result.path === LMU_NAVIGATION_PATH && result.status === 200) {
        await this.stampGameInfo(sink, result.body);
      }
    } catch {
      // The sink closed while the request was in flight; nothing to record.
    }
  }

  /** Writes a marker with game version info whenever it is first seen or changes. */
  private async stampGameInfo(sink: RecordSink, body: unknown): Promise<void> {
    const state = (body as { state?: Record<string, unknown> } | null)?.state;
    const build = state?.["appBuild"];
    if (build === undefined || String(build) === this.stampedBuild) return;
    this.stampedBuild = String(build);
    await sink.write(RecordKind.Marker, { label: "lmu-game-info", state });
  }
}
