import type { DeltaOutputs } from "../calc/delta";
import type { FuelOutputs } from "../calc/fuel";
import type { GapResult } from "../calc/gaps";
import type { LapHistory } from "../calc/laps";
import type { Proximity } from "../calc/proximity";
import type { SlowCarAhead } from "../calc/slow-car";
import type { Standings } from "../calc/standings";
import type { SimSource, SimState } from "../model";
import { emptyDerivedTrack, type DerivedTrack } from "../track/tracker";

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
  /**
   * Which track this is and whether its outline is known. The outline itself is large, so it is
   * not in the frame: overlays ask for it with the `getTrackOutline` command.
   */
  track: DerivedTrack;
  /** Standings for every non-pace car; null until a live frame has cars. */
  standings: Standings | null;
  /** Cars alongside the player; null when unknown. */
  proximity: Proximity | null;
  /** LMU virtual energy run through the fuel calculator in percent units; null when the car has none. */
  energy: FuelOutputs | null;
  /** Lap delta against every available reference; null until the player has lap data. */
  delta: DeltaOutputs | null;
  /** Nearest slow or stopped car ahead; null when there is none or it is unknown. */
  slowCar: SlowCarAhead | null;
  /** Recent completed laps of the focus car (player, else camera car); null without one. */
  laps: LapHistory | null;
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
  return {
    fuel: null,
    gaps: [],
    track: emptyDerivedTrack(),
    standings: null,
    proximity: null,
    energy: null,
    delta: null,
    slowCar: null,
    laps: null,
  };
}
