import { iracing } from "@overlay/sim-core";
import {
  IRSDK_EVENT_NAME,
  IRSDK_HEADER_BYTES,
  IRSDK_MAP_NAME,
  IRSDK_ST_CONNECTED,
  IRSDK_VAR_HEADER_BYTES,
  newestVarBuf,
  parseIrsdkHeader,
  type IrsdkHeader,
} from "../capture/irsdk";
import { STALE_CLOSE_MS } from "../capture/sim-capture";
import type { Clock, SharedMapping, SharedMemorySource, SignalEvent } from "../capture/shm";
import type { SessionParser } from "./session-parser";
import type { LiveSource, SourceFrame } from "./source";

/** Longest the sampling loop blocks on IRSDKDataValidEvent. */
export const IRACING_EVENT_WAIT_MS = 20;
/** Ticks that stop for this long while the sim says "connected" mean it hung or crashed. */
export const IRACING_STALL_MS = 2000;
/** Used when the event cannot be opened: about 60 Hz. */
const NO_EVENT_POLL_MS = 8;

/**
 * Live iRacing source. Read-only: the mapping is opened with FILE_MAP_READ and the event with
 * SYNCHRONIZE only.
 *
 * Coexistence with the capture process: both hold the same mapping and event. If iRacing creates
 * IRSDKDataValidEvent as an auto-reset event, a signal wakes only one waiter, so the two
 * processes could split signals. We tolerate that: after the wait we always read the newest
 * tickCount and skip repeats, so a lost wake-up costs at most one 20 ms wait. To be confirmed on
 * Windows (M1-6b).
 */
export class IracingLiveSource implements LiveSource {
  readonly id = "iracing";

  private map: SharedMapping | undefined;
  private event: SignalEvent | undefined;
  private adapter: iracing.IracingAdapter | undefined;
  private readonly head = Buffer.alloc(IRSDK_HEADER_BYTES);
  private varBuffer = Buffer.alloc(0);
  private lastTick = -1;
  private tableKey = "";
  private requestedInfoUpdate = -1;
  private observedTick = -1;
  private lastTickChangeMono = 0;
  private lastLiveMono = 0;
  private live = false;
  /** Frames dropped because the sim rewrote the buffer during the copy. */
  tornDiscarded = 0;

  constructor(
    private readonly shm: SharedMemorySource,
    private readonly clock: Clock,
    private readonly parser: SessionParser,
  ) {}

  /** Connected but no new tick for 2 s. */
  get stalled(): boolean {
    return this.map !== undefined && !this.live;
  }

  get pollIntervalMs(): number {
    return this.event ? 0 : NO_EVENT_POLL_MS;
  }

  probe(): boolean {
    const now = this.clock.monoMs();
    this.ensureOpen(now);
    if (!this.map) return false;
    this.updateLiveness(this.readHeader(), now);
    if (!this.live && now - this.lastLiveMono > STALE_CLOSE_MS) this.close();
    return this.live;
  }

  async read(): Promise<SourceFrame | null> {
    this.ensureOpen(this.clock.monoMs());
    const map = this.map;
    if (!map) return null;
    this.event?.wait(IRACING_EVENT_WAIT_MS);

    const header = this.readHeader();
    this.updateLiveness(header, this.clock.monoMs());
    if (!this.live || !sane(header, map)) return null;
    this.refreshTables(map, header);
    this.requestSessionInfo(map, header);

    const index = newestVarBuf(header);
    const entry = header.varBuf[index];
    if (!entry || entry.tickCount === this.lastTick || !this.adapter) return null;
    if (this.varBuffer.length !== header.bufLen) this.varBuffer = Buffer.alloc(header.bufLen);
    map.copy(this.varBuffer, entry.bufOffset, header.bufLen);
    // The sim rewrites the oldest buffer in place; a moved tickCount means our copy is torn.
    if (this.readHeader().varBuf[index]?.tickCount !== entry.tickCount) {
      this.tornDiscarded++;
      return null;
    }
    this.lastTick = entry.tickCount;
    return { state: this.adapter.toSimState(this.varBuffer, this.parser.latest()) };
  }

  close(): void {
    this.map?.close();
    this.event?.close();
    this.map = undefined;
    this.event = undefined;
    this.adapter = undefined;
    this.live = false;
    this.parser.close();
  }

  private ensureOpen(now: number): void {
    if (this.map) return;
    this.map = this.shm.openMapping(IRSDK_MAP_NAME);
    if (!this.map) return;
    this.event = this.shm.openEvent(IRSDK_EVENT_NAME);
    this.adapter = undefined;
    this.tableKey = "";
    this.requestedInfoUpdate = -1;
    this.lastTick = -1;
    this.observedTick = -1;
    this.lastTickChangeMono = now;
    this.lastLiveMono = now;
    this.parser.reset();
  }

  private readHeader(): IrsdkHeader {
    this.map?.copy(this.head, 0, IRSDK_HEADER_BYTES);
    return parseIrsdkHeader(this.head);
  }

  private updateLiveness(header: IrsdkHeader, now: number): void {
    const tick = header.varBuf[newestVarBuf(header)]?.tickCount ?? -1;
    if (tick !== this.observedTick) {
      this.observedTick = tick;
      this.lastTickChangeMono = now;
    }
    // Our own handle keeps the mapping alive after the sim exits, so require the connected bit
    // and ticks that still advance.
    this.live =
      (header.status & IRSDK_ST_CONNECTED) !== 0 &&
      now - this.lastTickChangeMono <= IRACING_STALL_MS;
    if (this.live) this.lastLiveMono = now;
  }

  /** Rebuilds the decoder when the var table changed (a new car or session layout). */
  private refreshTables(map: SharedMapping, header: IrsdkHeader): void {
    const key = `${header.numVars}:${header.bufLen}:${header.varHeaderOffset}`;
    if (key === this.tableKey && this.adapter) return;
    const length = header.varHeaderOffset + header.numVars * IRSDK_VAR_HEADER_BYTES;
    const blob = Buffer.alloc(length);
    map.copy(blob, 0, length);
    try {
      this.adapter = iracing.IracingAdapter.fromHeaderBytes(blob);
      this.tableKey = key;
    } catch {
      this.adapter = undefined;
    }
  }

  /** Hands changed session YAML to the parser; the previous info stays in use until it finishes. */
  private requestSessionInfo(map: SharedMapping, header: IrsdkHeader): void {
    if (header.sessionInfoUpdate === this.requestedInfoUpdate || header.sessionInfoLen <= 0) return;
    const yaml = Buffer.alloc(header.sessionInfoLen);
    map.copy(yaml, header.sessionInfoOffset, header.sessionInfoLen);
    // Changed while copying: the next read copies it again.
    if (this.readHeader().sessionInfoUpdate !== header.sessionInfoUpdate) return;
    this.requestedInfoUpdate = header.sessionInfoUpdate;
    this.parser.request(yaml);
  }
}

function sane(header: IrsdkHeader, map: SharedMapping): boolean {
  const entry = header.varBuf[newestVarBuf(header)];
  return (
    !!entry &&
    header.numVars > 0 &&
    header.bufLen > 0 &&
    header.varHeaderOffset >= IRSDK_HEADER_BYTES &&
    header.varHeaderOffset + header.numVars * IRSDK_VAR_HEADER_BYTES <= map.size &&
    entry.bufOffset >= 0 &&
    entry.bufOffset + header.bufLen <= map.size &&
    header.sessionInfoOffset >= 0 &&
    header.sessionInfoOffset + Math.max(header.sessionInfoLen, 0) <= map.size
  );
}
