/** Valid laps averaged for the lap time, the top speed and the fuel use of a setup. */
export const SETUP_RECENT_LAPS = 5;
/** Setups kept per car and track; the one used longest ago goes first. */
export const SETUP_MAX_PER_COMBO = 20;
/** Car and track combinations kept in the store; the one used longest ago goes first. */
export const SETUP_MAX_COMBOS = 100;

/** What a setup has done on its valid laps, as kept in the store. */
export interface SetupRecord {
  /** Valid laps counted so far. */
  laps: number;
  bestLapS: number | null;
  /** The last valid lap times, newest first, at most {@link SETUP_RECENT_LAPS}. */
  recentLapsS: number[];
  /** Best official time of each sector over the valid laps (null where none yet); null without sector data. */
  bestSectorsS: (number | null)[] | null;
  /** Highest speed of each of the last valid laps, m/s, newest first. */
  recentTopSpeedsMps: number[];
  /** Fuel used on each of the last valid laps that have a fuel reading, litres, newest first. */
  recentFuelL: number[];
  /** ISO time of the last lap counted. */
  updatedAt: string;
}

/** The setups of one car at one track, and the baseline the user pinned there. */
export interface SetupCombo {
  /** Setup key (see {@link setupKeyOf}) of the pinned baseline; null when none is pinned. */
  baseline: string | null;
  setups: Record<string, SetupRecord>;
  /** ISO time of the last change. */
  updatedAt: string;
}

/** Where setup statistics are kept between runs; the telemetry process provides a file-backed one. */
export interface SetupStatsStore {
  /** Synchronous; called when the car or track changes, never per tick. */
  load(comboKey: string): SetupCombo | null;
  /** Must not block the tick (queue the write). */
  save(comboKey: string, combo: SetupCombo): void;
}

/** One completed valid lap, as it is added to a setup's record. */
export interface SetupLap {
  lapTimeS: number;
  sectorTimes: readonly (number | null)[] | null;
  /** Highest speed on the lap, m/s; null when unknown. */
  topSpeedMps: number | null;
  /** Fuel used on the lap, litres; null when the fuel calculator did not count it. */
  fuelUsedL: number | null;
}

/** One side of the comparison: a setup and what it has done on its valid laps. */
export interface SetupSide {
  /** The setup's name without ".sto", with "*" when it is a modified copy. */
  name: string;
  /** Valid laps counted with this setup at this car and track. */
  laps: number;
  bestLapS: number | null;
  /** Mean of the last (up to) {@link SETUP_RECENT_LAPS} valid laps. */
  avgLapS: number | null;
  /** Best time of each official sector; null without sector data. */
  sectorsS: readonly (number | null)[] | null;
  /** Mean of the highest speed of each of the last (up to) 5 valid laps, m/s. */
  topSpeedMps: number | null;
  /** Mean fuel use of the last (up to) 5 valid laps with a fuel reading, litres. */
  fuelPerLapL: number | null;
}

/** Published as Derived.setupCompare: the baseline setup against the one loaded now. */
export interface SetupCompare {
  baseline: SetupSide;
  active: SetupSide;
  /** The baseline is the one pinned for this car and track (else the first setup of the session). */
  pinned: boolean;
}
