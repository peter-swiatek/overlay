import type { FuelOutputs, FuelPitWindow, TelemetryFrame } from "@overlay/sim-core/types";
import {
  computeLapTargets,
  computeRefuel,
  fuelLapsRemaining,
  lapsPerTank,
} from "@overlay/sim-core/pure";

/*
 * Fuel Calculator view model. Every number comes from sim-core's FuelOutputs (M2-10); this file
 * only composes the pure formulas for display.
 *
 * Defaults chosen by the orchestrator, not yet confirmed by Peter:
 *  - "Max" basis of the usage bars (Fuel history and Usage) is FuelOutputs.fuelMaxLap, the maximum
 *    per-lap use over the last 5 valid laps ("Fuel max lap"). The "Max basis: Session /
 *    Tank" select is therefore not offered. The fuel level bar is a tank gauge: 100 % = capacity.
 *  - Safety margin defaults to 1 lap (see manifest.ts).
 */

export type FuelUnit = "fuel" | "energy";
export type Tone = "gain" | "warn" | "loss" | null;

export interface FuelViewOptions {
  safetyMarginLaps: number;
  liveUpdates: boolean;
}

export interface ConsumptionRow {
  label: "LAST" | "AVG 5L" | "AVG 10L";
  perLap: number | null;
  laps: number | null;
  stintLaps: number | null;
  refuel: number | null;
}

export interface FuelView {
  unit: FuelUnit;
  /** Litres, or energy percent (0..100) when unit is "energy". */
  current: number | null;
  capacity: number | null;
  /** current / capacity, 0..1. */
  levelFraction: number | null;
  lapsToGo: number | null;
  stintLaps: number;
  stintTimeS: number | null;
  /** Session time remaining, whole seconds; null when unknown or the session is lap-limited. */
  timeRemainingS: number | null;
  /** The player's lap in progress; null when unknown. */
  currentLap: number | null;
  consumption: ConsumptionRow[];
  /** Oldest first; fraction = used / maxBasis clamped 0..1. */
  history: { lapNumber: number; used: number; fraction: number }[];
  maxBasis: number | null;
  targets: { extraLaps: number; laps: number; perLap: number }[];
  lapsLeft: { avg: number | null; last: number | null; worst: number | null };
  /**
   * Per value: "gain" when it covers lapsToGo + safety margin, "warn" when it covers lapsToGo but
   * not the margin, "loss" when it is short, null when unknown.
   */
  lapsLeftState: { avg: Tone; last: Tone; worst: Tone };
  /** Null until 2 valid laps. */
  pitWindow: FuelPitWindow | null;
  refuel: number | null;
  usage: { avg10: number | null; avg5: number | null; last: number | null };
  validLapCount: number;
}

/** What the selector returns: the view plus the lap counter that `freezeAtLine` watches. */
export interface FuelSnapshot {
  view: FuelView | null;
  lapsCompleted: number | null;
}

const round = (value: number, step: number): number => Math.round(value / step) * step;
const amount = (v: number | null): number | null => (v === null ? null : round(v, 0.01));
const laps = (v: number | null): number | null => (v === null ? null : round(v, 0.1));
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function tone(value: number | null, lapsToGo: number | null, margin: number): Tone {
  if (value === null || lapsToGo === null) return null;
  if (value >= lapsToGo + margin) return "gain";
  return value >= lapsToGo ? "warn" : "loss";
}

/** Share of the max basis a usage figure takes, for bars; 0 when the basis is unknown. */
export function usageFraction(value: number | null, maxBasis: number | null): number {
  if (value === null || maxBasis === null || !(maxBasis > 0)) return 0;
  return round(clamp01(value / maxBasis), 0.01);
}

function pickSource(frame: TelemetryFrame): { outputs: FuelOutputs; unit: FuelUnit } | null {
  // LMU virtual energy replaces fuel only in LMU and only when the car has it.
  if (frame.state.sim === "lmu" && frame.derived.energy !== null) {
    return { outputs: frame.derived.energy, unit: "energy" };
  }
  return frame.derived.fuel === null ? null : { outputs: frame.derived.fuel, unit: "fuel" };
}

/** Null while there is no fuel sample yet. */
export function fuelView(frame: TelemetryFrame | null, options: FuelViewOptions): FuelView | null {
  if (frame === null) return null;
  const source = pickSource(frame);
  if (source === null) return null;
  const { outputs: o, unit } = source;
  const player = frame.state.player;
  const current = unit === "energy" ? percentOf(player.energyFraction) : player.fuelL;
  const capacity = unit === "energy" ? 100 : o.tankCapacityL;
  const margin = options.safetyMarginLaps;

  const row = (label: ConsumptionRow["label"], perLap: number | null): ConsumptionRow => ({
    label,
    perLap: amount(perLap),
    laps: laps(current === null || perLap === null ? null : fuelLapsRemaining(current, perLap)),
    // "Stint" = laps per full tank.
    stintLaps: laps(lapsPerTank(capacity, perLap)),
    refuel: amount(
      computeRefuel({
        lapsToGo: o.lapsToGo,
        perLap,
        currentFuel: current,
        safetyMarginLaps: margin,
        tankCapacity: capacity,
      }),
    ),
  });

  const last =
    current === null || o.fuelLastLap === null ? null : fuelLapsRemaining(current, o.fuelLastLap);
  const lapsLeftRaw = { avg: o.lapsRemainingAvg, last, worst: o.lapsRemainingConservative };

  const maxBasis = o.fuelMaxLap;
  const history = o.recentLaps
    .map((lap) => ({
      lapNumber: lap.lapNumber,
      used: round(lap.used, 0.01),
      fraction: usageFraction(lap.used, maxBasis),
    }))
    .reverse();

  return {
    unit,
    current: amount(current),
    capacity: amount(capacity),
    levelFraction:
      current === null || capacity === null || !(capacity > 0)
        ? null
        : round(clamp01(current / capacity), 0.01),
    lapsToGo: laps(o.lapsToGo),
    stintLaps: o.stintLaps,
    stintTimeS: o.stintTimeS === null ? null : Math.round(o.stintTimeS),
    timeRemainingS:
      frame.state.session.timeRemainingS === null
        ? null
        : Math.round(frame.state.session.timeRemainingS),
    currentLap: playerCar(frame)?.lapInProgress ?? null,
    consumption: [
      row("LAST", o.fuelLastLap),
      row("AVG 5L", o.fuelAvg5Lap),
      row("AVG 10L", o.fuelAvg10Lap),
    ],
    history,
    maxBasis: amount(maxBasis),
    targets:
      current === null || o.lapsRemainingAvg === null
        ? []
        : computeLapTargets(current, o.lapsRemainingAvg, [0, 1, 2]).map((t) => ({
            extraLaps: t.extraLaps,
            laps: t.laps,
            perLap: round(t.perLap, 0.01),
          })),
    lapsLeft: {
      avg: laps(lapsLeftRaw.avg),
      last: laps(lapsLeftRaw.last),
      worst: laps(lapsLeftRaw.worst),
    },
    lapsLeftState: {
      avg: tone(lapsLeftRaw.avg, o.lapsToGo, margin),
      last: tone(lapsLeftRaw.last, o.lapsToGo, margin),
      worst: tone(lapsLeftRaw.worst, o.lapsToGo, margin),
    },
    pitWindow: o.pitWindow,
    refuel: amount(
      computeRefuel({
        lapsToGo: o.lapsToGo,
        perLap: o.fuelAvgLap,
        currentFuel: current,
        safetyMarginLaps: margin,
        tankCapacity: capacity,
      }),
    ),
    usage: {
      avg10: amount(o.fuelAvg10Lap),
      avg5: amount(o.fuelAvg5Lap),
      last: amount(o.fuelLastLap),
    },
    validLapCount: o.validLapCount,
  };
}

function percentOf(fraction: number | null): number | null {
  return fraction === null ? null : fraction * 100;
}

function playerCar(frame: TelemetryFrame): TelemetryFrame["state"]["cars"][number] | undefined {
  const idx = frame.state.playerCarIdx;
  return idx === null ? undefined : frame.state.cars.find((c) => c.carIdx === idx);
}

/** Lap counter of the player's car, for `freezeAtLine`. */
export function playerLapsCompleted(frame: TelemetryFrame | null): number | null {
  if (frame === null) return null;
  return playerCar(frame)?.lapsCompleted ?? null;
}

/** Selector for useTelemetry: view and lap counter together. */
export function fuelSnapshot(frame: TelemetryFrame | null, options: FuelViewOptions): FuelSnapshot {
  return { view: fuelView(frame, options), lapsCompleted: playerLapsCompleted(frame) };
}

export interface FreezeMemory {
  lap: number | null;
  view: FuelView | null;
}

export const emptyFreezeMemory = (): FreezeMemory => ({ lap: null, view: null });

/**
 * Live updates off: targets, refuel, laps left, pit window and consumption keep their values from
 * the last start/finish crossing; fuel level, history and usage stay live. The memory is reset
 * when the unit changes (fuel <-> energy).
 */
export function freezeAtLine(
  view: FuelView | null,
  lapsCompleted: number | null,
  memory: FreezeMemory,
): FuelView | null {
  if (view === null) return null;
  const stored = memory.view;
  if (stored !== null && stored.unit !== view.unit) {
    memory.lap = null;
    memory.view = null;
  }
  if (memory.view === null || memory.lap !== lapsCompleted) {
    memory.lap = lapsCompleted;
    memory.view = view;
    return view;
  }
  const held = memory.view;
  return {
    ...view,
    targets: held.targets,
    refuel: held.refuel,
    lapsLeft: held.lapsLeft,
    lapsLeftState: held.lapsLeftState,
    pitWindow: held.pitWindow,
    consumption: held.consumption,
  };
}

/** Shown in edit mode while there is no data, so the layout can be placed. */
export const SAMPLE_FUEL_VIEW: FuelView = {
  unit: "fuel",
  current: 32.5,
  capacity: 50,
  levelFraction: 0.65,
  lapsToGo: 30,
  stintLaps: 30,
  stintTimeS: 1200,
  timeRemainingS: 1475,
  currentLap: 15,
  consumption: [
    { label: "LAST", perLap: 2.8, laps: 11.6, stintLaps: 39.2, refuel: 12.5 },
    { label: "AVG 5L", perLap: 2.78, laps: 11.6, stintLaps: 39.5, refuel: 12 },
    { label: "AVG 10L", perLap: 2.76, laps: 11.7, stintLaps: 39.8, refuel: 11.8 },
  ],
  history: [
    { lapNumber: 2, used: 2.45, fraction: 0.93 },
    { lapNumber: 3, used: 2.52, fraction: 0.96 },
    { lapNumber: 4, used: 2.63, fraction: 1 },
    { lapNumber: 5, used: 2.48, fraction: 0.94 },
    { lapNumber: 6, used: 2.5, fraction: 0.95 },
  ],
  maxBasis: 2.63,
  targets: [
    { extraLaps: 0, laps: 39, perLap: 1.12 },
    { extraLaps: 1, laps: 40, perLap: 1.09 },
    { extraLaps: 2, laps: 41, perLap: 1.05 },
  ],
  lapsLeft: { avg: 11.8, last: 11.6, worst: 10.4 },
  lapsLeftState: { avg: "warn", last: "gain", worst: "loss" },
  pitWindow: { start: 15, end: 25, feasible: true },
  refuel: 12,
  usage: { avg10: 2.76, avg5: 2.78, last: 2.8 },
  validLapCount: 5,
};
