/** Completed laps kept per car in {@link LapHistory.laps}. */
export const LAP_HISTORY_MAX = 30;

/** One completed lap of the tracked car. */
export interface LapRecord {
  /** Number of the completed lap (the completed-lap count right after it). */
  lapNumber: number;
  /** The sim's lap time, seconds; null when it never arrived. */
  lapTimeS: number | null;
  /**
   * Counts for the best, the averages and the optimal lap: timed by the sim, watched from the
   * line, never off track, no new incidents (player only), never on pit road or in the stall.
   */
  valid: boolean;
  /** The lap touched pit road or the stall (an in-lap or out-lap). */
  pit: boolean;
  /** Track temperature when the lap was completed, degrees Celsius. */
  trackTempC: number | null;
  /**
   * Fuel used on the lap, litres. Only for the player's car and only for laps the fuel calculator
   * counts as valid (no refuel, not an out-lap); null otherwise.
   */
  fuelUsedL: number | null;
  /** Official sector times of this lap, seconds (null where not timed); null without sector data. */
  sectorTimes: readonly (number | null)[] | null;
}

/** Published as Derived.laps: the focus car's recent laps. */
export interface LapHistory {
  /** The car the laps belong to (player, else the camera car). */
  carIdx: number;
  /** Newest first, at most {@link LAP_HISTORY_MAX}. */
  laps: readonly LapRecord[];
  /** Fastest valid lap since the car was first tracked this session; null before one. */
  bestLapS: number | null;
  /** Number of the lap that set {@link bestLapS} (the first lap to reach that time). */
  bestLapNumber: number | null;
  /**
   * Sum of the best official sector times over the valid laps; null without sector data or
   * before every sector has a valid time.
   */
  optimalLapS: number | null;
}
