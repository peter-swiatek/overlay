import { LAP_TRACE_BINS, type LapTrace } from "./types";

const MAX_BACK = 0.01;
const MAX_FORWARD = 0.05;
const MIN_COVERAGE = 0.98;
const EPS = 1e-9;

/** Records one lap as a LapTrace while it is driven. */
export class LapTraceRecorder {
  private readonly timeS: number[];
  private readonly speedMps: number[];
  private nextBin = 1;
  private prevFrac = 0;
  private prevElapsed = 0;
  private prevSpeed: number | null = null;
  private started = false;
  private isBroken = false;

  constructor(private readonly bins: number = LAP_TRACE_BINS) {
    this.timeS = new Array<number>(bins).fill(Number.NaN);
    this.speedMps = new Array<number>(bins).fill(Number.NaN);
    this.start();
  }

  /** A new lap starts at the line now (elapsed 0). */
  start(): void {
    this.timeS.fill(Number.NaN);
    this.speedMps.fill(Number.NaN);
    this.timeS[0] = 0;
    this.nextBin = 1;
    this.prevFrac = 0;
    this.prevElapsed = 0;
    this.prevSpeed = null;
    this.started = false;
    this.isBroken = false;
  }

  /**
   * One tick. Every bin boundary passed since the previous tick gets a time and speed by linear
   * interpolation between the two ticks. Returns false and marks the lap broken when the lap
   * fraction goes back by more than 0.01, jumps forward by more than 0.05 in one tick, or a value
   * is not finite. A broken lap stays broken until start().
   */
  sample(lapDistPct: number, elapsedS: number, speedMps: number | null): boolean {
    if (this.isBroken) return false;
    if (!Number.isFinite(lapDistPct) || !Number.isFinite(elapsedS)) return this.breakLap();
    const speed = speedMps !== null && Number.isFinite(speedMps) ? speedMps : null;
    if (!this.started) {
      this.started = true;
      if (speed !== null) this.speedMps[0] = speed;
      this.prevSpeed = speed;
    }
    const delta = lapDistPct - this.prevFrac;
    if (delta < -MAX_BACK || delta > MAX_FORWARD) return this.breakLap();
    if (delta <= 0) return true; // standing still or a tiny step back: keep the last point
    const elapsed = Math.max(elapsedS, this.prevElapsed);
    const last = Math.min(this.bins - 1, Math.floor(lapDistPct * this.bins + EPS));
    for (let k = this.nextBin; k <= last; k++) {
      const a = (k / this.bins - this.prevFrac) / delta;
      this.timeS[k] = this.prevElapsed + a * (elapsed - this.prevElapsed);
      if (speed !== null && this.prevSpeed !== null) {
        this.speedMps[k] = this.prevSpeed + a * (speed - this.prevSpeed);
      } else if (speed !== null) {
        this.speedMps[k] = speed;
      } else if (this.prevSpeed !== null) {
        this.speedMps[k] = this.prevSpeed;
      }
    }
    if (last >= this.nextBin) this.nextBin = last + 1;
    this.prevFrac = lapDistPct;
    this.prevElapsed = elapsed;
    this.prevSpeed = speed ?? this.prevSpeed;
    return true;
  }

  /** The lap's trace, or null when broken or fewer than 98 % of bins were reached. Missing speeds copy the neighbour. */
  finish(): LapTrace | null {
    if (this.isBroken) return null;
    const reached = this.nextBin; // bins 0..reached-1 hold a time
    if (reached < Math.ceil(this.bins * MIN_COVERAGE)) return null;
    const timeS = this.timeS.slice();
    for (let k = reached; k < this.bins; k++) timeS[k] = timeS[reached - 1] ?? 0;
    const speedMps = this.speedMps.slice();
    const firstKnown = speedMps.findIndex((v) => !Number.isNaN(v));
    if (firstKnown < 0) return null;
    for (let k = 0; k < firstKnown; k++) speedMps[k] = speedMps[firstKnown] ?? 0;
    for (let k = firstKnown + 1; k < this.bins; k++) {
      if (Number.isNaN(speedMps[k])) speedMps[k] = speedMps[k - 1] ?? 0;
    }
    return { timeS, speedMps };
  }

  get broken(): boolean {
    return this.isBroken;
  }

  private breakLap(): false {
    this.isBroken = true;
    return false;
  }
}

function clampFrac(f: number): number {
  return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
}

/** Elapsed time of the reference at `lapDistPct`: linear between bins; the last bin closes at lapTimeS. */
export function traceTimeAt(trace: LapTrace, lapTimeS: number, lapDistPct: number): number {
  const n = trace.timeS.length;
  const pos = clampFrac(lapDistPct) * n;
  const k = Math.min(n - 1, Math.floor(pos));
  const a = pos - k;
  const t0 = trace.timeS[k] ?? 0;
  const t1 = k + 1 < n ? (trace.timeS[k + 1] ?? lapTimeS) : lapTimeS;
  return t0 + a * (t1 - t0);
}

/** Reference speed at `lapDistPct`, linear between bins (wraps to bin 0 after the last). */
export function traceSpeedAt(trace: LapTrace, lapDistPct: number): number {
  const n = trace.speedMps.length;
  const pos = clampFrac(lapDistPct) * n;
  const k = Math.min(n - 1, Math.floor(pos));
  const a = pos - k;
  const v0 = trace.speedMps[k] ?? 0;
  const v1 = trace.speedMps[(k + 1) % n] ?? v0;
  return v0 + a * (v1 - v0);
}

/** elapsedS - traceTimeAt(...). */
export function computedDelta(
  trace: LapTrace,
  lapTimeS: number,
  lapDistPct: number,
  elapsedS: number,
): number {
  return elapsedS - traceTimeAt(trace, lapTimeS, lapDistPct);
}
