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
 * Fuel to add so the car reaches the finish with `safetyMarginLaps` to spare. Derived from the reference
 * fuel delta (`currentFuel - requiredFuel`, with `requiredFuel = lapsToGo * perLap` as the tracker
 * uses): refuel is the shortfall once the margin laps are added, never negative, and capped at the
 * room left in the tank when the capacity is known. The reference gives no refuel formula of its own.
 */
export function computeRefuel(input: {
  lapsToGo: number | null;
  perLap: number | null;
  currentFuel: number | null;
  safetyMarginLaps: number;
  tankCapacity: number | null;
}): number | null {
  const { lapsToGo, perLap, currentFuel, safetyMarginLaps, tankCapacity } = input;
  if (lapsToGo === null || perLap === null || currentFuel === null) return null;
  if (!(perLap > 0)) return null;
  const required = (lapsToGo + safetyMarginLaps) * perLap;
  const refuel = Math.max(0, required - currentFuel);
  if (tankCapacity === null) return refuel;
  return Math.min(refuel, Math.max(0, tankCapacity - currentFuel));
}

/**
 * The reference +1 lap target generalised (`currentFuel / (floor(lapsRemaining) + 1)`): the per-lap use
 * that stretches the fuel to `floor(lapsRemaining) + extra` laps, for each extra asked for.
 * Targets that would need zero or fewer laps are left out.
 */
export function computeLapTargets(
  currentFuel: number,
  lapsRemaining: number,
  extraLaps: readonly number[],
): { extraLaps: number; laps: number; perLap: number }[] {
  const base = Math.floor(lapsRemaining);
  const out: { extraLaps: number; laps: number; perLap: number }[] = [];
  for (const extra of extraLaps) {
    const laps = base + extra;
    if (laps > 0) out.push({ extraLaps: extra, laps, perLap: currentFuel / laps });
  }
  return out;
}

/**
 * Laps of fuel per full tank at a given use: The reference `maxLapsPerTank` (`tankCapacity / fuelAvgLap`)
 * from the pit window, shown as the "stint" column. Null when either input is unknown.
 */
export function lapsPerTank(tankCapacity: number | null, perLap: number | null): number | null {
  if (tankCapacity === null || perLap === null) return null;
  return tankCapacity > 0 && perLap > 0 ? tankCapacity / perLap : null;
}

/**
 * The reference pit window. `currentLap` is completed laps, `totalLaps` the race distance in laps
 * (completed + lap fraction + laps to go). End keeps a one-lap buffer; start is the earliest lap from which one
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
  // Round away float noise so an exact whole number of laps does not tip ceil() up a lap.
  const start = Math.max(currentLap, Math.ceil(round9(totalLaps - maxLapsPerTank)));
  const end = Math.floor(round9(currentLap + lapsUntilEmpty - 1));
  return { start, end, feasible: start <= end };
}

function round9(v: number): number {
  return Math.round(v * 1e9) / 1e9;
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
