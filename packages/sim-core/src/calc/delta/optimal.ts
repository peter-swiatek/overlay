import { LAP_TRACE_BINS, type LapTrace } from "./types";

export const OPTIMAL_SECTORS = 20;

/** Best sector times over the laps added; sector s spans bins [s*20, (s+1)*20) of LAP_TRACE_BINS. */
export class OptimalLap {
  private readonly best: number[] = new Array<number>(OPTIMAL_SECTORS).fill(
    Number.POSITIVE_INFINITY,
  );
  private laps = 0;

  addLap(trace: LapTrace, lapTimeS: number): void {
    const n = trace.timeS.length;
    if (n !== LAP_TRACE_BINS || !Number.isFinite(lapTimeS)) return;
    const per = n / OPTIMAL_SECTORS;
    const times: number[] = [];
    for (let s = 0; s < OPTIMAL_SECTORS; s++) {
      const start = trace.timeS[s * per] ?? Number.NaN;
      const end = s === OPTIMAL_SECTORS - 1 ? lapTimeS : (trace.timeS[(s + 1) * per] ?? Number.NaN);
      const t = end - start;
      if (!Number.isFinite(t) || t <= 0) return;
      times.push(t);
    }
    times.forEach((t, s) => {
      if (t < (this.best[s] ?? Number.POSITIVE_INFINITY)) this.best[s] = t;
    });
    this.laps++;
  }

  /** Sum of the best sector times; null before the first lap. */
  get lapS(): number | null {
    if (this.laps === 0) return null;
    return this.best.reduce((a, b) => a + b, 0);
  }

  reset(): void {
    this.best.fill(Number.POSITIVE_INFINITY);
    this.laps = 0;
  }
}
