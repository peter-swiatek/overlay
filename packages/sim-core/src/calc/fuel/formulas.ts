import type { FuelPitWindow } from "./types";

/** `currentFuel / perLap`. Null when the per-lap figure is not positive. */
export function fuelLapsRemaining(currentFuelL: number, perLapL: number): number | null {
  return perLapL > 0 ? currentFuelL / perLapL : null;
}

/** `currentFuel - lapsToGo * fuelAvgLap`; positive is surplus, negative means a refuel is needed. */
export function computeFuelDelta(
  currentFuelL: number,
  lapsToGo: number,
  fuelAvgLap: number,
): number {
  return currentFuelL - lapsToGo * fuelAvgLap;
}

/** `currentFuel / (floor(lapsRemaining) + 1)`: the per-lap burn that stretches the fuel one more lap. */
export function computePlusOneLapTarget(currentFuelL: number, lapsRemainingAvg: number): number {
  return currentFuelL / (Math.floor(lapsRemainingAvg) + 1);
}

/**
 * The reference pit window. `currentLap` is completed laps, `totalLaps` the race distance in laps
 * (completed + laps to go). End keeps a one-lap buffer; start is the earliest lap from which one
 * full tank still reaches the finish.
 */
export function computeFuelPitWindow(args: {
  currentFuelL: number;
  currentLap: number;
  totalLaps: number;
  fuelAvgLap: number;
  tankCapacityL: number;
}): FuelPitWindow | null {
  const { currentFuelL, currentLap, totalLaps, fuelAvgLap, tankCapacityL } = args;
  if (!(fuelAvgLap > 0)) return null;
  const maxLapsPerTank = tankCapacityL / fuelAvgLap;
  const lapsUntilEmpty = currentFuelL / fuelAvgLap;
  return {
    start: Math.max(currentLap, Math.ceil(totalLaps - maxLapsPerTank)),
    end: Math.floor(currentLap + lapsUntilEmpty - 1),
  };
}

/** The reference tank estimate; only right before the first refuel. */
export function estimateFuelTankCapacity(
  currentFuelL: number,
  completedLaps: number,
  fuelAvgLap: number,
): number {
  return currentFuelL + completedLaps * fuelAvgLap;
}

/**
 * Racing laps left in a timed race, including the lap in progress when the leader's clock hits
 * zero (the leader must still finish that lap). Assumes the leader's pace is about `avgLapS`.
 * TODO: use the leader's own average lap and position instead of ours.
 */
export function estimateRaceLapsRemaining(
  timeRemainingS: number,
  avgLapS: number,
  lapDistPct: number,
): number | null {
  if (!(avgLapS > 0)) return null;
  const toLine = 1 - lapDistPct;
  return toLine + Math.ceil(Math.max(0, timeRemainingS - toLine * avgLapS) / avgLapS);
}

/**
 * Team fuel sharing: the mean of the teammates' averages when any are connected, else our own.
 * Teammates without a valid average (null) are ignored.
 */
export function effectiveFuelAvg(
  own: number | null,
  teammates: readonly (number | null)[],
): number | null {
  const known = teammates.filter((v): v is number => v !== null && v > 0);
  if (known.length === 0) return own;
  return known.reduce((a, b) => a + b, 0) / known.length;
}
