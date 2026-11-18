import type { LapRecord, TelemetryFrame } from "@overlay/sim-core/types";
import { focusCarIdx } from "../shared/rows";

/*
 * Lap Times view model. Every lap comes from sim-core's lap history (Derived.laps) of the focus
 * car. Laps that are not valid (off track, incidents, pit road, no lap time, joined part way)
 * are listed but muted, and never count for the best, the average, the optimal lap or a delta
 * colour.
 */

export type DeltaTone = "gain" | "loss" | null;

export interface LapTimesOptions {
  rows: number;
}

export interface LapRow {
  lapNumber: number;
  lapTimeS: number | null;
  /**
   * This lap minus the session best as it stood before this lap, rounded to 0.01 s: negative is
   * a new best (time gained), positive is time lost. Null without a time or an earlier best.
   */
  deltaS: number | null;
  /** Coloured only when this lap is valid and the rounded delta is not zero. */
  deltaTone: DeltaTone;
  trackTempC: number | null;
  fuelUsedL: number | null;
  /** The focus car's best valid lap. */
  best: boolean;
  valid: boolean;
  pit: boolean;
}

export interface LapTimesView {
  carNumber: string | null;
  driverName: string | null;
  stintLaps: number | null;
  /** Newest first. */
  rows: LapRow[];
  bestLapS: number | null;
  /** Lap number of the focus car's best valid lap. */
  bestLapNumber: number | null;
  /** Mean of the last (up to) 5 valid laps. */
  avgLapS: number | null;
  /** Mean of the last (up to) 10 valid laps. */
  avg10LapS: number | null;
  optimalLapS: number | null;
}

/** Valid laps averaged in the footer: a short and a long average. */
export const AVG_LAPS = 5;
export const AVG_LONG_LAPS = 10;
const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;

function timed(lap: LapRecord | undefined): lap is LapRecord & { lapTimeS: number } {
  return lap !== undefined && lap.lapTimeS !== null;
}

function counts(lap: LapRecord | undefined): lap is LapRecord & { lapTimeS: number } {
  return timed(lap) && lap.valid;
}

/**
 * The session best as it stood before the lap at `index` (history newest first): the fastest
 * valid lap older than it. The overall best also counts when it is older and has already left
 * the kept history.
 */
function bestBefore(
  laps: readonly LapRecord[],
  index: number,
  best: { lapNumber: number | null; lapTimeS: number | null },
): number | null {
  const lap = laps[index];
  if (lap === undefined) return null;
  let t: number | null =
    best.lapTimeS !== null && best.lapNumber !== null && best.lapNumber < lap.lapNumber
      ? best.lapTimeS
      : null;
  for (const older of laps.slice(index + 1)) {
    if (counts(older) && (t === null || older.lapTimeS < t)) t = older.lapTimeS;
  }
  return t;
}

export function lapRows(
  laps: readonly LapRecord[],
  bestLapNumber: number | null,
  count: number,
  bestLapS: number | null = null,
): LapRow[] {
  const best = { lapNumber: bestLapNumber, lapTimeS: bestLapS };
  return laps.slice(0, Math.max(0, count)).map((lap, i) => {
    const ref = bestBefore(laps, i, best);
    const deltaS = timed(lap) && ref !== null ? round2(lap.lapTimeS - ref) : null;
    const coloured = deltaS !== null && deltaS !== 0 && counts(lap);
    return {
      lapNumber: lap.lapNumber,
      lapTimeS: lap.lapTimeS,
      deltaS,
      deltaTone: coloured ? (deltaS < 0 ? "gain" : "loss") : null,
      trackTempC: lap.trackTempC,
      fuelUsedL: lap.fuelUsedL,
      best: lap.valid && lap.lapNumber === bestLapNumber,
      valid: lap.valid,
      pit: lap.pit,
    };
  });
}

export function averageLap(laps: readonly LapRecord[], count = AVG_LAPS): number | null {
  const times = laps
    .filter(counts)
    .slice(0, count)
    .map((l) => l.lapTimeS);
  return times.length === 0 ? null : times.reduce((a, b) => a + b, 0) / times.length;
}

/** Null without a live frame or a focus car. */
export function lapTimesView(
  frame: TelemetryFrame | null,
  options: LapTimesOptions,
): LapTimesView | null {
  if (frame === null || frame.status !== "live") return null;
  const history = frame.derived.laps;
  const carIdx = history?.carIdx ?? focusCarIdx(frame.state);
  if (carIdx === null) return null;
  const car = frame.state.cars.find((c) => c.carIdx === carIdx);
  const entry = frame.derived.standings?.entries.find((e) => e.carIdx === carIdx);
  const laps = history?.carIdx === carIdx ? history.laps : [];
  const bestLapNumber = history?.bestLapNumber ?? null;
  return {
    carNumber: car?.carNumber ?? null,
    driverName: car?.driverName ?? null,
    stintLaps: entry?.stintLaps ?? null,
    rows: lapRows(laps, bestLapNumber, options.rows, history?.bestLapS ?? null),
    bestLapS: history?.bestLapS ?? null,
    bestLapNumber,
    avgLapS: averageLap(laps),
    avg10LapS: averageLap(laps, AVG_LONG_LAPS),
    optimalLapS: history?.optimalLapS ?? null,
  };
}

/** The design hand-off's laps, shown in edit mode while there is no data so the layout can be placed. */
export const SAMPLE_LAP_TIMES_VIEW: LapTimesView = (() => {
  const times = [100.42, 100.28, 100.18, 100.35, 100.22, 99.82, 100.15, 100.0];
  const fuel = [2.33, 2.35, 2.34, 2.36, 2.37, 2.39, 2.38, 2.4];
  const temps = [30.6, 30.7, 30.7, 30.8, 30.8, 30.9, 31.0, 31.0];
  const laps: LapRecord[] = times
    .map((t, i) => ({
      lapNumber: 8 + i,
      lapTimeS: t,
      valid: true,
      pit: false,
      trackTempC: temps[i] ?? null,
      fuelUsedL: fuel[i] ?? null,
      sectorTimes: null,
    }))
    .reverse();
  // Lap 7 (1:40.30) is the lap before the window.
  laps.push({ ...laps[laps.length - 1]!, lapNumber: 7, lapTimeS: 100.3 });
  return {
    carNumber: "1",
    driverName: "Alex Marlow",
    stintLaps: 15,
    rows: lapRows(laps, 13, 5, 99.82),
    bestLapS: 99.82,
    bestLapNumber: 13,
    avgLapS: averageLap(laps),
    avg10LapS: averageLap(laps, AVG_LONG_LAPS),
    optimalLapS: 99.64,
  };
})();
