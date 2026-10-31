import { GAP_ROLLING_LAPS } from "./types";

function usable(lapTimeS: number): boolean {
  return Number.isFinite(lapTimeS) && lapTimeS > 0;
}

/** 5-lap rolling average of valid laps per car, plus per-car, per-class and session bests. */
export class RollingLapTimes {
  private readonly recent = new Map<number, number[]>();
  private readonly carBest = new Map<number, number>();
  private readonly classBestByClass = new Map<number, number>();
  private sessionBestS: number | undefined;

  /** Ignores laps flagged invalid by the caller and non-positive or non-finite times. */
  record(carIdx: number, lapTimeS: number, valid = true, classId = 0): void {
    if (!valid || !usable(lapTimeS)) return;
    const laps = this.recent.get(carIdx) ?? [];
    laps.push(lapTimeS);
    if (laps.length > GAP_ROLLING_LAPS) laps.shift();
    this.recent.set(carIdx, laps);
    this.carBest.set(carIdx, Math.min(this.carBest.get(carIdx) ?? Infinity, lapTimeS));
    this.classBestByClass.set(
      classId,
      Math.min(this.classBestByClass.get(classId) ?? Infinity, lapTimeS),
    );
    this.sessionBestS = Math.min(this.sessionBestS ?? Infinity, lapTimeS);
  }

  /** Forget everything. The caller must call this on session change. */
  reset(): void {
    this.recent.clear();
    this.carBest.clear();
    this.classBestByClass.clear();
    this.sessionBestS = undefined;
  }

  /** Forget one car's laps (reused carIdx). Class and session bests stay. */
  resetCar(carIdx: number): void {
    this.recent.delete(carIdx);
    this.carBest.delete(carIdx);
  }

  average(carIdx: number): number | undefined {
    const laps = this.recent.get(carIdx);
    if (!laps || laps.length === 0) return undefined;
    return laps.reduce((a, b) => a + b, 0) / laps.length;
  }

  best(carIdx: number): number | undefined {
    return this.carBest.get(carIdx);
  }

  classBest(classId: number): number | undefined {
    return this.classBestByClass.get(classId);
  }

  sessionBest(): number | undefined {
    return this.sessionBestS;
  }
}
