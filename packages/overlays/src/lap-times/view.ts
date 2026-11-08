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
  /** This lap minus the lap before, rounded to 0.01 s; null without both times. */
  deltaS: number | null;
  /** Coloured only when both laps are valid and the rounded delta is not zero. */
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
  optimalLapS: number | null;
}

/** Valid laps averaged in the footer. */
export const AVG_LAPS = 5;
const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;

function timed(lap: LapRecord | undefined): lap is LapRecord & { lapTimeS: number } {
  return lap !== undefined && lap.lapTimeS !== null;
}

function counts(lap: LapRecord | undefined): lap is LapRecord & { lapTimeS: number } {
  return timed(lap) && lap.valid;
}

/** The lap right before `lap` in the history (newest first), when it is the previous lap number. */
function before(laps: readonly LapRecord[], index: number): LapRecord | undefined {
  const lap = laps[index];
  const prev = laps[index + 1];
  return lap !== undefined && prev !== undefined && prev.lapNumber === lap.lapNumber - 1
    ? prev
    : undefined;
}

export function lapRows(
  laps: readonly LapRecord[],
  bestLapNumber: number | null,
  count: number,
): LapRow[] {
  return laps.slice(0, Math.max(0, count)).map((lap, i) => {
    const prev = before(laps, i);
    const deltaS = timed(lap) && timed(prev) ? round2(lap.lapTimeS - prev.lapTimeS) : null;
    const coloured = deltaS !== null && deltaS !== 0 && counts(lap) && counts(prev);
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
    rows: lapRows(laps, bestLapNumber, options.rows),
    bestLapS: history?.bestLapS ?? null,
    bestLapNumber,
    avgLapS: averageLap(laps),
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
    rows: lapRows(laps, 13, 5),
    bestLapS: 99.82,
    bestLapNumber: 13,
    avgLapS: averageLap(laps),
    optimalLapS: 99.64,
  };
})();
