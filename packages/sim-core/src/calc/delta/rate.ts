const TIME_CONSTANT_S = 0.5;
const MAX_GAP_S = 1;

function clamp(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

/** Smoothed rate of change of a delta: exponential average, time constant 0.5 s, clamped -1..1. */
export class DeltaRate {
  private prev: number | null = null;
  private avg: number | null = null;

  /** Null on the first sample, after reset, after a gap of more than 1 s, or for a null delta. */
  next(tickS: number, deltaS: number | null): number | null {
    if (deltaS === null || !Number.isFinite(deltaS)) {
      this.reset();
      return null;
    }
    if (!Number.isFinite(tickS) || tickS > MAX_GAP_S) {
      this.reset();
      this.prev = deltaS;
      return null;
    }
    const prev = this.prev;
    this.prev = deltaS;
    if (prev === null) return null;
    if (tickS <= 0) return this.avg === null ? null : clamp(this.avg);
    const raw = (deltaS - prev) / tickS;
    if (this.avg === null) {
      this.avg = raw;
    } else {
      const alpha = 1 - Math.exp(-tickS / TIME_CONSTANT_S);
      this.avg += alpha * (raw - this.avg);
    }
    return clamp(this.avg);
  }

  reset(): void {
    this.prev = null;
    this.avg = null;
  }
}
