/**
 * Relative gap module (The reference overlay two-tier gap).
 *
 * SIGN CONVENTION (single source of truth for this module):
 *   gap = focusTime - targetTime   (mini-sector tier)
 *   gap = (focus% - target%, wrapped to (-0.5, 0.5]) x targetLapTime   (position tier)
 * A target AHEAD of the focus car on track therefore gives a NEGATIVE gap; a target behind
 * gives a positive gap. The result is wrapped into (-refLap/2, refLap/2].
 */

/** Number of mini-sectors per lap; one point every 0.5% of lap distance. */
export const GAP_MINI_SECTOR_COUNT = 200;

/** Fallback lap time when nothing better is known, in seconds. */
export const GAP_DEFAULT_LAP_TIME_S = 90;

/** Number of laps in the rolling average. */
export const GAP_ROLLING_LAPS = 5;

/** One tick of one car. `offTrack` must also be true for NotInWorld (iRacing surface -1). */
export interface GapCarTick {
  sessionTimeS: number;
  carIdx: number;
  lap: number;
  /** 0..1; negative or non-finite means the car is not in the world. */
  lapDistPct: number;
  onPitRoad: boolean;
  offTrack: boolean;
  /** Class used to key track references; defaults to 0. */
  classId?: number;
}

/**
 * Elapsed time at each mini-sector boundary of one lap: `times[i]` is the time at
 * `i / 200` of lap distance, so `times[0] = 0` and `times[200] = lapTimeS`.
 */
export interface GapReferenceLap {
  lapTimeS: number;
  times: readonly number[];
}

export interface GapCompletedLap {
  carIdx: number;
  classId: number;
  lap: number;
  lapTimeS: number;
  /** No pit road, no off-track, no gaps in the mini-sector data. */
  clean: boolean;
}

export interface GapCarPosition {
  carIdx: number;
  lapDistPct: number;
}

/** Candidate lap times for the position tier, in chain order. Undefined entries are skipped. */
export interface GapLapTimeSources {
  targetAverageS?: number | undefined;
  targetBestS?: number | undefined;
  classBestS?: number | undefined;
  sessionBestS?: number | undefined;
}

export type GapLapTimeSource =
  "targetAverage" | "targetBest" | "classBest" | "sessionBest" | "default";

export interface GapReferences {
  targetReference?: GapReferenceLap | undefined;
  trackReference?: GapReferenceLap | undefined;
  lapTimes?: GapLapTimeSources | undefined;
}

export type GapResult =
  | {
      /** A car is not in the world (lapDistPct outside [0, 1]); no gap can be given. */
      tier: "unavailable";
      gapS?: undefined;
    }
  | {
      tier: "miniSector";
      /** Seconds; negative when the target is ahead on track. */
      gapS: number;
      reference: "target" | "track";
      referenceLapTimeS: number;
    }
  | {
      tier: "position";
      gapS: number;
      lapTimeS: number;
      lapTimeSource: GapLapTimeSource;
    };

export interface GapReferenceJson {
  lapTimeS: number;
  times: number[];
}

export interface GapRecorderJson {
  version: 1;
  /** Track reference per class id. */
  trackReferences: Record<string, GapReferenceJson>;
}
