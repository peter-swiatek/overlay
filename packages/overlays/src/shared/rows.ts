import type {
  Car,
  DerivedGap,
  SimState,
  StandingsEntry,
  StandingsGap,
  TelemetryFrame,
} from "@overlay/sim-core/types";
import type { Decimals } from "@overlay/ui/types";

export interface DriverRow {
  carIdx: number;
  /** The focus car (playerCarIdx, else focusCarIdx). */
  isFocus: boolean;
  driverName: string | null;
  teamName: string | null;
  carNumber: string | null;
  /** car.classId ?? "" (the standings' class key). */
  classKey: string;
  className: string | null;
  classColour: string | null;
  /** In the chosen mode (live or official), each falling back to the other when null. */
  position: number | null; // in class
  overallPosition: number | null;
  licence: string | null;
  iRating: number | null;
  gapToLeader: StandingsGap | null;
  gapToClassLeader: StandingsGap | null;
  interval: StandingsGap | null;
  /** derived.gaps for this car (negative = ahead of the focus car); 0 for the focus car; null unknown. Rounded to gapDecimals. */
  relativeGapS: number | null;
  /** Lap times rounded to lapDecimals; deltas rounded to gapDecimals. */
  lastLapS: number | null;
  bestLapS: number | null;
  avgLapS: number | null;
  lastLapDeltaS: number | null;
  bestLapDeltaS: number | null;
  fastest: boolean; // sessionBest || classBest
  lap: number | null; // lapInProgress
  onPitRoad: boolean;
  inPitStall: boolean;
  lastPitLap: number | null;
  stintLaps: number | null;
  prevStintLaps: number | null;
  /** startPosition − overallPosition; null outside races or before the start. */
  positionsGained: number | null;
  /** LMU Car.fuelFraction 0..1; null in iRacing. */
  energyFraction: number | null;
  /** lapsCompleted + lapDistPct, for ordering; null unknown. */
  progressLaps: number | null;
}

export interface DriverRowOptions {
  /** runtime.livePositions */
  livePositions: boolean;
  gapDecimals: Decimals;
  lapDecimals: Decimals;
}

/** playerCarIdx ?? focusCarIdx */
export function focusCarIdx(state: SimState): number | null {
  return state.playerCarIdx ?? state.focusCarIdx;
}

/** Rounds to `decimals`; never returns -0. */
function round(value: number | null, decimals: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f + 0;
}

function difference(a: number | null, b: number | null, decimals: number): number | null {
  return a === null || b === null ? null : round(a - b, decimals);
}

function chosen(live: boolean, liveValue: number | null, official: number | null): number | null {
  return live ? (liveValue ?? official) : (official ?? liveValue);
}

function buildRow(
  car: Car,
  entry: StandingsEntry | undefined,
  gap: DerivedGap | undefined,
  focusIdx: number | null,
  focusCar: Car | undefined,
  options: DriverRowOptions,
): DriverRow {
  const { livePositions, gapDecimals, lapDecimals } = options;
  const isFocus = car.carIdx === focusIdx;
  const overallPosition = chosen(
    livePositions,
    entry?.livePosition ?? null,
    entry?.position ?? car.position,
  );
  const startPosition = entry?.startPosition ?? null;
  let relativeGapS: number | null = null;
  if (isFocus) relativeGapS = 0;
  else if (gap !== undefined) relativeGapS = round(gap.gapS, gapDecimals);
  const lastLap = car.lastLapS;
  const bestLap = car.bestLapS;
  return {
    carIdx: car.carIdx,
    isFocus,
    driverName: car.driverName,
    teamName: car.teamName,
    carNumber: car.carNumber,
    classKey: car.classId ?? "",
    className: car.className,
    classColour: car.classColour,
    position: chosen(
      livePositions,
      entry?.liveClassPosition ?? null,
      entry?.classPosition ?? car.classPosition,
    ),
    overallPosition,
    licence: car.license,
    iRating: car.iRating,
    gapToLeader: entry?.gapToLeader ?? null,
    gapToClassLeader: entry?.gapToClassLeader ?? null,
    interval: entry?.interval ?? null,
    relativeGapS,
    lastLapS: round(lastLap, lapDecimals),
    bestLapS: round(bestLap, lapDecimals),
    avgLapS: round(entry?.avgLapS ?? null, lapDecimals),
    // The reference gives no formula for the lap deltas: we compare with the focus car.
    lastLapDeltaS: difference(lastLap, focusCar?.lastLapS ?? null, gapDecimals),
    bestLapDeltaS: difference(bestLap, focusCar?.bestLapS ?? null, gapDecimals),
    fastest: (entry?.sessionBest ?? false) || (entry?.classBest ?? false),
    lap: car.lapInProgress,
    onPitRoad: car.onPitRoad === true,
    inPitStall: car.inPitStall === true,
    lastPitLap: entry?.lastPitLap ?? null,
    stintLaps: entry?.stintLaps ?? null,
    prevStintLaps: entry?.prevStintLaps ?? null,
    positionsGained:
      startPosition === null || overallPosition === null ? null : startPosition - overallPosition,
    energyFraction: car.fuelFraction,
    progressLaps:
      entry?.progressLaps ??
      (car.lapsCompleted !== null && car.lapDistPct !== null
        ? car.lapsCompleted + car.lapDistPct
        : null),
  };
}

/** Every non-pace car in state.cars order, joined with its StandingsEntry and DerivedGap by carIdx. [] unless frame.status === "live". */
export function driverRows(frame: TelemetryFrame | null, options: DriverRowOptions): DriverRow[] {
  if (frame === null || frame.status !== "live") return [];
  const { state, derived } = frame;
  const entries = new Map<number, StandingsEntry>();
  for (const e of derived.standings?.entries ?? []) entries.set(e.carIdx, e);
  const gaps = new Map<number, DerivedGap>();
  for (const g of derived.gaps) gaps.set(g.carIdx, g);
  const focusIdx = focusCarIdx(state);
  const focusCar = focusIdx === null ? undefined : state.cars.find((c) => c.carIdx === focusIdx);
  const rows: DriverRow[] = [];
  for (const car of state.cars) {
    if (car.isPaceCar === true) continue;
    rows.push(
      buildRow(car, entries.get(car.carIdx), gaps.get(car.carIdx), focusIdx, focusCar, options),
    );
  }
  return rows;
}

function sameGap(a: StandingsGap | null, b: StandingsGap | null): boolean {
  if (a === null || b === null) return a === b;
  return a.laps === b.laps && a.seconds === b.seconds;
}

function sameRow(a: DriverRow, b: DriverRow): boolean {
  for (const key of Object.keys(a) as Array<keyof DriverRow>) {
    if (key === "gapToLeader" || key === "gapToClassLeader" || key === "interval") {
      if (!sameGap(a[key], b[key])) return false;
    } else if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/** Next rows, reusing the previous object for each carIdx whose row is structurally equal. */
export function reuseRows(prev: readonly DriverRow[], next: readonly DriverRow[]): DriverRow[] {
  const before = new Map<number, DriverRow>();
  for (const row of prev) before.set(row.carIdx, row);
  return next.map((row) => {
    const old = before.get(row.carIdx);
    return old !== undefined && sameRow(old, row) ? old : row;
  });
}
