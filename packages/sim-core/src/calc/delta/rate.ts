const TIME_CONSTANT_S = 0.5;
const MAX_GAP_S = 1;

function clamp(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

/** Smoothed rate of change of a delta: exponential average, time constant 0.5 s, clamped -1..1. */
export class DeltaRate {
  private prev: number | null = null;
  private prevTickS: number | null = null;
  private avg: number | null = null;

  /**
   * `tickS` is the absolute clock (state.tickTimeS). Null on the first sample, after reset, after
   * a gap of more than 1 s, when the clock does not advance, or for a null delta.
   */
  next(tickS: number, deltaS: number | null): number | null {
    if (deltaS === null || !Number.isFinite(deltaS) || !Number.isFinite(tickS)) {
      this.reset();
      return null;
    }
    const prevTickS = this.prevTickS;
    const prev = this.prev;
    this.prev = deltaS;
    this.prevTickS = tickS;
    if (prev === null || prevTickS === null) return null;
    const dt = tickS - prevTickS;
    if (dt <= 0 || dt > MAX_GAP_S) {
      this.avg = null;
      return null;
    }
    const raw = (deltaS - prev) / dt;
    if (this.avg === null) {
      this.avg = raw;
    } else {
      const alpha = 1 - Math.exp(-dt / TIME_CONSTANT_S);
      this.avg += alpha * (raw - this.avg);
    }
    return clamp(this.avg);
  }

  reset(): void {
    this.prev = null;
    this.prevTickS = null;
    this.avg = null;
  }
}
