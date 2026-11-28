import { lmu } from "@overlay/sim-core";
import { LMU_DATA_NAME, LMU_LIVE_WINDOW_MS, LMU_MAX_COPY_ATTEMPTS } from "../capture/lmu-names";
import {
  copyConsistent,
  type Clock,
  type SharedMapping,
  type SharedMemorySource,
} from "../capture/shm";
import { STALE_CLOSE_MS } from "../capture/sim-capture";
import type { LiveSource, SourceFrame } from "./source";

/** 50 Hz, the rate LMU updates its shared memory at. */
export const LMU_POLL_MS = 20;

/** How often the repair screen (aero and suspension damage) is asked for while LMU is live. */
export const LMU_REPAIR_POLL_MS = 2000;

/** The read-only GET of the game's REST API (`LmuRestClient`); it never throws for HTTP errors. */
export interface LmuRestGetter {
  get(path: string): Promise<{ path: string; status: number; body: unknown }>;
}

/**
 * Live Le Mans Ultimate source. Read-only and lock-free: it never opens the game's lock mapping
 * or its events. A frame is accepted only when two consecutive copies of the used bytes are
 * identical; after 5 failed attempts the frame is dropped.
 *
 * With a REST client it also asks the game for its repair screen (a GET, the same one the
 * capture tool records) every {@link LMU_REPAIR_POLL_MS}, one request at a time and only while
 * frames are decoding, for the aero and suspension damage the shared memory lacks. A failed
 * request leaves those values null.
 */
export class LmuLiveSource implements LiveSource {
  readonly id = "lmu";
  readonly pollIntervalMs = LMU_POLL_MS;

  private map: SharedMapping | undefined;
  private copyA = Buffer.alloc(0);
  private copyB = Buffer.alloc(0);
  private previous = Buffer.alloc(0);
  private hasPrevious = false;
  private lastChangeMono = Number.NEGATIVE_INFINITY;
  private lastSeenMono = 0;
  private decoder = new lmu.LmuDecoder();
  /** Frames dropped because no consistent copy was obtained. */
  inconsistentDropped = 0;

  private restInFlight = false;
  private lastRestMono = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly shm: SharedMemorySource,
    private readonly clock: Clock,
    private readonly rest?: LmuRestGetter,
  ) {}

  /** The buffer has not changed for 5 s: paused, in a menu, or a dead game. */
  get stalled(): boolean {
    return this.map !== undefined && !this.live;
  }

  private get live(): boolean {
    return (
      this.map !== undefined && this.clock.monoMs() - this.lastChangeMono <= LMU_LIVE_WINDOW_MS
    );
  }

  probe(): boolean {
    const now = this.clock.monoMs();
    this.ensureOpen(now);
    if (!this.map) return false;
    // While reading, `read` keeps the change time fresh; otherwise take one copy per probe.
    if (now - this.lastChangeMono > 1000) {
      this.map.copy(this.copyA, 0, this.copyA.length);
      this.observe(this.copyA, now);
    }
    if (!this.live && now - this.lastSeenMono > STALE_CLOSE_MS) this.close();
    return this.live;
  }

  async read(): Promise<SourceFrame | null> {
    const now = this.clock.monoMs();
    this.ensureOpen(now);
    if (!this.map) return null;
    const { consistent } = copyConsistent(this.map, this.copyA, this.copyB, LMU_MAX_COPY_ATTEMPTS);
    if (!consistent) {
      this.inconsistentDropped++;
      return null;
    }
    // An unchanged buffer is a pause, a menu or a dead game: nothing new to publish.
    if (!this.observe(this.copyB, now)) return null;
    const result = this.decoder.decode(this.copyB);
    if (result.error === null) this.pollRepair(now);
    return { state: result.state, error: result.error };
  }

  /** Starts a repair screen request when one is due; its answer reaches the decoder later. */
  private pollRepair(now: number): void {
    const rest = this.rest;
    if (!rest || this.restInFlight || now - this.lastRestMono < LMU_REPAIR_POLL_MS) return;
    this.restInFlight = true;
    this.lastRestMono = now;
    const decoder = this.decoder;
    const path = lmu.LMU_REPAIR_PATH;
    rest
      .get(path)
      .catch(() => ({ path, status: 0, body: null }))
      .then((response) => {
        // A closed source has a new decoder; the answer belongs to the old session.
        if (decoder === this.decoder) decoder.observeRest(response);
      })
      .finally(() => {
        this.restInFlight = false;
      });
  }

  close(): void {
    this.map?.close();
    this.map = undefined;
    this.hasPrevious = false;
    this.lastChangeMono = Number.NEGATIVE_INFINITY;
    this.decoder = new lmu.LmuDecoder();
  }

  private ensureOpen(now: number): void {
    if (this.map) return;
    // Only the data mapping; the lock mapping and the events are deliberately left alone.
    const map = this.shm.openMapping(LMU_DATA_NAME);
    if (!map) return;
    this.map = map;
    const bytes = Math.min(map.size, lmu.LMU_USED_BYTES);
    this.copyA = Buffer.alloc(bytes);
    this.copyB = Buffer.alloc(bytes);
    this.previous = Buffer.alloc(bytes);
    this.hasPrevious = false;
    this.lastChangeMono = Number.NEGATIVE_INFINITY;
    this.lastSeenMono = now;
  }

  /** Records whether the buffer moved since the last observation. */
  private observe(frame: Buffer, now: number): boolean {
    const changed = this.hasPrevious && !frame.equals(this.previous);
    if (changed) {
      this.lastChangeMono = now;
      this.lastSeenMono = now;
    }
    frame.copy(this.previous);
    this.hasPrevious = true;
    return changed;
  }
}
