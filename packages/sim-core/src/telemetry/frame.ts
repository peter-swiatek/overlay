import type { FuelOutputs } from "../calc/fuel";
import type { GapResult } from "../calc/gaps";
import type { SimSource, SimState } from "../model";

export type TelemetryStatus = "live" | "waiting" | "error";

export interface DerivedGap {
  carIdx: number;
  /** Seconds relative to the player; negative = the car is ahead (see calc/gaps/types.ts). */
  gapS: number | null;
  tier: GapResult["tier"];
}

export interface Derived {
  /** Null until the player has produced a fuel sample. */
  fuel: FuelOutputs | null;
  /** Every other non-pace car, in the order of `state.cars`. */
  gaps: DerivedGap[];
}

/** What the telemetry process publishes to overlay renderers. Plain structured-cloneable data. */
export interface TelemetryFrame {
  /** Counts up from 1 per telemetry process; restarts when the process restarts. */
  seq: number;
  source: SimSource;
  status: TelemetryStatus;
  error: string | null;
  state: SimState;
  derived: Derived;
}

export function emptyDerived(): Derived {
  return { fuel: null, gaps: [] };
}
