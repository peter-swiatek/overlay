/** One per-tick input. Units: litres for `fuelL` (a second tracker can feed energy fraction instead). */
export interface FuelSample {
  sessionTimeS: number;
  sessionNum: number;
  /** iRacing SessionState; informational, pace laps are signalled through `isPaceLap`. */
  sessionState: number;
  /** Completed laps counter. */
  lap: number;
  /** 0..1 */
  lapDistPct: number;
  fuelL: number;
  onPitRoad: boolean;
  inPitStall: boolean;
  /** Parade / formation laps (iRacing SessionState 3), decided by the caller. */
  isPaceLap: boolean;
  sessionType: string;
}

export type FuelInvalidReason =
  "outlap" | "partial" | "paceLap" | "dataError" | "refuel" | "sessionChange" | "unknownStart";

export interface FuelLapRecord {
  /** Completed-lap counter value after this lap finished. */
  lapNumber: number;
  usedL: number;
  valid: boolean;
  /** Empty when valid; the first matching rule in precedence order otherwise. */
  reason: FuelInvalidReason | null;
}

export interface FuelTrackerOptions {
  /** Laps using less than this are partial. Default 0.5. */
  minLapUse?: number;
  /** Laps using more than this are data errors. Default 50. */
  maxLapUse?: number;
  /** Fuel rising more than this above the lap start fuel is a refuel. Default 1. */
  refuelJump?: number;
  /** How many recent valid laps feed `fuelMaxLap`. Default 5. */
  maxLapWindow?: number;
}

export interface FuelContext {
  /**
   * Racing laps still to run from the current position, may be fractional and includes the lap in
   * progress. Lap-limited race: laps left. Timed race: use `estimateRaceLapsRemaining`.
   */
  lapsToGo: number | null;
  /** Real tank capacity from the sim. When absent, the reference estimate is used until the first refuel. */
  tankCapacityL?: number | null;
  /** Team average (see `effectiveFuelAvg`) replacing the own average in all average-based outputs. */
  fuelAvgOverride?: number | null;
}

export interface FuelPitWindow {
  start: number;
  end: number;
}

export interface FuelOutputs {
  fuelLastLap: number | null;
  fuelAvgLap: number | null;
  fuelMaxLap: number | null;
  lapsRemainingAvg: number | null;
  lapsRemainingConservative: number | null;
  fuelDelta: number | null;
  plusOneLapTarget: number | null;
  fuelSavingNeeded: number | null;
  pitWindow: FuelPitWindow | null;
  tankCapacityL: number | null;
  validLapCount: number;
}
