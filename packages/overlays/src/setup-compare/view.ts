import type { SetupSide, TelemetryFrame } from "@overlay/sim-core/types";

/*
 * Setup Compare view model. Everything comes from sim-core's setup statistics
 * (Derived.setupCompare): per setup, at this car and track, the best valid lap, the mean of the
 * last 5 valid laps, the best time in each official sector, the mean top speed and fuel use of the
 * last 5 valid laps. Deltas are active minus baseline: negative is faster.
 */

export type DeltaTone = "gain" | "loss" | null;

export interface SetupCompareOptions {
  sectors: boolean;
}

export interface CompareRow {
  id: string;
  label: string;
  baselineS: number | null;
  activeS: number | null;
  /** Active minus baseline, rounded to 0.001 s; null without both or when both are one setup. */
  deltaS: number | null;
  tone: DeltaTone;
  /** Best Lap only: the active setup's best beats the baseline's. */
  activeFastest: boolean;
}

export interface SetupCompareView {
  baselineName: string;
  activeName: string;
  /** The baseline is the setup loaded now: no deltas. */
  same: boolean;
  /** The baseline is pinned for this car and track. */
  pinned: boolean;
  rows: CompareRow[];
  /** Active minus baseline mean top speed, m/s; null without both or when both are one setup. */
  topSpeedDeltaMps: number | null;
  /** The active setup's mean fuel use per lap, litres. */
  fuelPerLapL: number | null;
  /** Active minus baseline fuel per lap, litres; null without both or when both are one setup. */
  fuelDeltaL: number | null;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

function delta(base: number | null, active: number | null, same: boolean): number | null {
  if (same || base === null || active === null) return null;
  return active - base;
}

function timeRow(
  id: string,
  label: string,
  baselineS: number | null,
  activeS: number | null,
  same: boolean,
): CompareRow {
  const d = delta(baselineS, activeS, same);
  const deltaS = d === null ? null : round3(d);
  return {
    id,
    label,
    baselineS,
    activeS,
    deltaS,
    tone: deltaS === null || deltaS === 0 ? null : deltaS < 0 ? "gain" : "loss",
    activeFastest: false,
  };
}

/** One row per official sector of the active setup's layout; a baseline on another layout has none. */
function sectorRows(base: SetupSide, active: SetupSide, same: boolean): CompareRow[] {
  const layout = active.sectorsS ?? base.sectorsS;
  if (layout === null) return [];
  const baseSectors = base.sectorsS?.length === layout.length ? base.sectorsS : null;
  const activeSectors = active.sectorsS?.length === layout.length ? active.sectorsS : null;
  return layout.map((_, i) =>
    timeRow(
      `sector-${i + 1}`,
      `Sector ${i + 1}`,
      baseSectors?.[i] ?? null,
      activeSectors?.[i] ?? null,
      same,
    ),
  );
}

export function compareView(
  base: SetupSide,
  active: SetupSide,
  pinned: boolean,
  options: SetupCompareOptions,
): SetupCompareView {
  const same = base.name === active.name;
  const best = timeRow("best", "Best Lap", base.bestLapS, active.bestLapS, same);
  best.activeFastest = best.deltaS !== null && best.deltaS < 0;
  const fuelDelta = delta(base.fuelPerLapL, active.fuelPerLapL, same);
  return {
    baselineName: base.name,
    activeName: active.name,
    same,
    pinned,
    rows: [
      best,
      timeRow("avg", "5-Lap Avg", base.avgLapS, active.avgLapS, same),
      ...(options.sectors ? sectorRows(base, active, same) : []),
    ],
    topSpeedDeltaMps: delta(base.topSpeedMps, active.topSpeedMps, same),
    fuelPerLapL: active.fuelPerLapL,
    fuelDeltaL: fuelDelta,
  };
}

/** Null without a live frame or a named setup. */
export function setupCompareView(
  frame: TelemetryFrame | null,
  options: SetupCompareOptions,
): SetupCompareView | null {
  if (frame === null || frame.status !== "live") return null;
  const cmp = frame.derived.setupCompare;
  if (cmp === null || cmp === undefined) return null;
  return compareView(cmp.baseline, cmp.active, cmp.pinned, options);
}

const KMH = 1 / 3.6;

/** The design hand-off's comparison (three decimals), shown in edit mode while there is no data. */
export function sampleSetupCompareView(options: SetupCompareOptions): SetupCompareView {
  const base: SetupSide = {
    name: "spa_race_v1",
    laps: 8,
    bestLapS: 100.184,
    avgLapS: 100.342,
    sectorsS: [31.421, 41.883, 26.88],
    topSpeedMps: 265.0 * KMH,
    fuelPerLapL: 2.4,
  };
  const active: SetupSide = {
    name: "spa_lowdf_v2",
    laps: 6,
    bestLapS: 99.817,
    avgLapS: 100.018,
    sectorsS: [31.244, 41.828, 26.745],
    topSpeedMps: 268.4 * KMH,
    fuelPerLapL: 2.38,
  };
  return compareView(base, active, false, options);
}
