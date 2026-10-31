import {
  Deriver,
  emptyDerived,
  emptySimState,
  type SimSource,
  type TelemetryFrame,
} from "@overlay/sim-core";
import type { TelemetrySourceChoice } from "../shared/telemetry-types";
import { AutoSelector, DETECT_INTERVAL_MS, type LiveSim } from "./auto-select";
import type { LiveSource, TelemetrySource } from "./source";

/** Never poll a source faster than this when it had nothing new, so a stuck event cannot spin. */
const MIN_IDLE_POLL_MS = 1;
/** After a failed read, wait this long before trying again. */
const ERROR_RETRY_MS = 250;

export interface SourceSelection {
  source: TelemetrySourceChoice;
  replayPath?: string | undefined;
  replaySpeed?: number | undefined;
  replayLoop?: boolean | undefined;
}

export interface EngineDeps {
  /** Live sims; a missing entry (not on Windows) is never live. */
  live: Partial<Record<LiveSim, LiveSource>>;
  createReplay(path: string, speed: number, loop: boolean): TelemetrySource;
  createMock(): TelemetrySource;
  publish(frame: TelemetryFrame): void;
  onStatus?(status: TelemetryFrame["status"], source: SimSource | null, error: string | null): void;
  /** Calculators to use; tests pass their own to inspect them. */
  deriver?: Deriver;
  /** Reads the clock. Defaults to Date.now, which fake timers control. */
  nowMs?(): number;
}

/**
 * Picks a source, reads it, derives values and hands finished frames to `publish`. Owns the two
 * timers: the read loop and the once-a-second sim detection. All decisions are in small pieces
 * (AutoSelector, the sources, Deriver) so each can be tested alone.
 */
export class TelemetryEngine {
  private readonly deriver: Deriver;
  private selector = new AutoSelector();
  private selection: SourceSelection = { source: "auto" };
  private active: TelemetrySource | null = null;
  private seq = 0;
  private running = false;
  private loopTimer: ReturnType<typeof setTimeout> | undefined;
  private detectTimer: ReturnType<typeof setInterval> | undefined;
  private lastSource: SimSource | null = null;
  private lastReported = "";
  /** The source whose frames the Deriver last saw; it is reset only when this changes. */
  private lastActivated: TelemetrySource | null = null;
  private stallReported = false;

  constructor(private readonly deps: EngineDeps) {
    this.deriver = deps.deriver ?? new Deriver();
  }

  get activeSource(): SimSource | null {
    return this.active?.id ?? null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.applySelection();
    this.detectTimer = setInterval(() => this.detect(), DETECT_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.loopTimer);
    clearInterval(this.detectTimer);
    this.loopTimer = undefined;
    this.detectTimer = undefined;
    this.releaseActive();
    for (const live of Object.values(this.deps.live)) live?.close();
  }

  setSource(selection: SourceSelection): void {
    if (sameSelection(this.selection, selection)) return;
    this.selection = selection;
    if (this.running) this.applySelection();
  }

  private applySelection(): void {
    const { source } = this.selection;
    const order: readonly LiveSim[] =
      source === "auto"
        ? ["iracing", "lmu"]
        : source === "iracing" || source === "lmu"
          ? [source]
          : [];
    // A live sim that is still wanted keeps running through a change of selection.
    const keep = this.active?.id === "iracing" || this.active?.id === "lmu" ? this.active.id : null;
    if (keep === null || !order.includes(keep)) this.releaseActive();
    if (source === "replay") {
      const path = this.selection.replayPath;
      if (path === undefined) return this.publishWaiting("Replay needs a file path");
      this.activate(
        this.deps.createReplay(
          path,
          this.selection.replaySpeed ?? 1,
          this.selection.replayLoop ?? true,
        ),
      );
    } else if (source === "mock") {
      this.activate(this.deps.createMock());
    } else {
      this.selector = new AutoSelector(order, keep !== null && order.includes(keep) ? keep : null);
      this.detect();
    }
  }

  /** Once a second for live sims: probe, let the selector decide, switch if it changed. */
  private detect(): void {
    const { source } = this.selection;
    if (source === "replay" || source === "mock") return;
    const probes = new Map<LiveSim, boolean>();
    const isLive = (sim: LiveSim): boolean => {
      let live = probes.get(sim);
      if (live === undefined) {
        live = this.deps.live[sim]?.probe() ?? false;
        probes.set(sim, live);
      }
      return live;
    };
    const now = this.deps.nowMs?.() ?? Date.now();
    const chosen = this.selector.update(now, isLive);
    // Probe the other sim too, so that its handles open and its liveness is tracked.
    for (const sim of ["iracing", "lmu"] as const) isLive(sim);
    const current = this.active?.id ?? null;
    if (chosen !== current) {
      this.releaseActive();
      const next = chosen === null ? undefined : this.deps.live[chosen];
      if (next) this.activate(next);
    }
    if (this.active === null || this.active.stalled === true) this.publishWaiting(null);
  }

  private activate(source: TelemetrySource): void {
    // Coming back to the same sim (a pause, a short outage) keeps the fuel history; the Deriver
    // detects a real new session itself.
    if (source !== this.lastActivated) this.deriver.reset();
    this.lastActivated = source;
    this.active = source;
    this.stallReported = false;
    this.scheduleRead(0);
  }

  private releaseActive(): void {
    clearTimeout(this.loopTimer);
    this.loopTimer = undefined;
    const active = this.active;
    this.active = null;
    // Live sims stay open (the detector keeps probing them); only private sources close.
    if (active && active.id !== "iracing" && active.id !== "lmu") active.close();
  }

  private scheduleRead(delayMs: number): void {
    clearTimeout(this.loopTimer);
    this.loopTimer = setTimeout(() => void this.readOnce(), delayMs);
  }

  private async readOnce(): Promise<void> {
    const source = this.active;
    if (!this.running || source === null) return;
    let delay = source.pollIntervalMs;
    try {
      const sourceFrame = await source.read();
      if (this.active !== source) return;
      if (sourceFrame) {
        this.stallReported = false;
        if (sourceFrame.restart) this.deriver.reset();
        this.emitFrame(source.id, sourceFrame.state, sourceFrame.error ?? null);
      } else {
        if (source.ended) return this.publishWaiting(null);
        // A sim that stopped ticking (a crash) shows as waiting at once; only switching to
        // another sim waits for the 5 s hysteresis.
        if (source.stalled === true && !this.stallReported) {
          this.stallReported = true;
          this.publishWaiting(null);
        }
        delay = Math.max(delay, MIN_IDLE_POLL_MS);
      }
    } catch (error) {
      if (this.active !== source) return;
      this.emit(source.id, "error", String(error), emptySimState(source.id), emptyDerived());
      delay = ERROR_RETRY_MS;
    }
    if (this.active === source) this.scheduleRead(delay);
  }

  private emitFrame(id: SimSource, state: TelemetryFrame["state"], error: string | null): void {
    if (error !== null) this.emit(id, "error", error, state, emptyDerived());
    else this.emit(id, "live", null, state, this.deriver.next(state));
  }

  private publishWaiting(error: string | null): void {
    const source = this.lastSource ?? "iracing";
    this.emit(
      source,
      error === null ? "waiting" : "error",
      error,
      emptySimState(source),
      emptyDerived(),
    );
  }

  private emit(
    source: SimSource,
    status: TelemetryFrame["status"],
    error: string | null,
    state: TelemetryFrame["state"],
    derived: TelemetryFrame["derived"],
  ): void {
    if (status !== "waiting") this.lastSource = source;
    this.deps.publish({ seq: ++this.seq, source, status, error, state, derived });
    const reported = `${status}|${status === "waiting" ? "" : source}|${error ?? ""}`;
    if (reported !== this.lastReported) {
      this.lastReported = reported;
      this.deps.onStatus?.(status, status === "waiting" ? null : source, error);
    }
  }
}

function sameSelection(a: SourceSelection, b: SourceSelection): boolean {
  if (a.source !== b.source) return false;
  if (a.source !== "replay") return true;
  return (
    a.replayPath === b.replayPath &&
    a.replaySpeed === b.replaySpeed &&
    a.replayLoop === b.replayLoop
  );
}
