/** How far ahead the Deriver looks for a slow car, metres. */
export const SLOW_CAR_RANGE_M = 1000;

/** The nearest slow or stopped car ahead of the player on track. */
export interface SlowCarAhead {
  carIdx: number;
  /** Metres along the track from the player to that car, 0..SLOW_CAR_RANGE_M. */
  distanceM: number;
  /** Its estimated speed, m/s. */
  speedMps: number;
  /** Below 2 m/s. */
  stopped: boolean;
}

/** One car the detector holds as slow (see `SlowCarDetector.slowCars`). */
export interface SlowCarEstimate {
  carIdx: number;
  /** Its estimated speed, m/s. */
  speedMps: number;
  /** How long the estimate has been below the slow limit, seconds. */
  slowForS: number;
}
