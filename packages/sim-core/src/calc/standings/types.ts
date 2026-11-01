import type { GapReferenceLap } from "../gaps";

export interface StandingsGap {
  /** Whole laps behind (0 on the same lap). */
  laps: number;
  /** Seconds behind within the lap; null when unknown. */
  seconds: number | null;
}

export interface StandingsEntry {
  carIdx: number;
  /** Official position from the sim (S/F based). */
  position: number | null;
  classPosition: number | null;
  /** Distance-based position from lapsCompleted + lapDistPct. */
  livePosition: number | null;
  liveClassPosition: number | null;
  /** lapsCompleted + lapDistPct; null when unknown. */
  progressLaps: number | null;
  /** In live order. Null for cars with unknown progress. */
  gapToLeader: StandingsGap | null;
  gapToClassLeader: StandingsGap | null;
  /** To the car one live place ahead in the same class; null for the class leader. */
  interval: StandingsGap | null;
  /** Rolling average of the last 5 clean laps (the reference average lap). */
  avgLapS: number | null;
  /** This car's best lap is the fastest overall / in its class this session. */
  sessionBest: boolean;
  classBest: boolean;
  pitStops: number;
  /** lapsCompleted when the car last left pit road; null if never seen pitting. */
  lastPitLap: number | null;
  /** Laps since the last pit exit (or since first seen). */
  stintLaps: number | null;
  prevStintLaps: number | null;
  /** Races only: live position when the race went green; null before that or in other sessions. */
  startPosition: number | null;
}

export interface Standings {
  /** Every non-pace car, in state.cars order. */
  entries: StandingsEntry[];
  sessionBestLapS: number | null;
  /** Keyed by classId ("" for cars without one). */
  classBestLapS: Record<string, number>;
  /** iRacing strength of field over cars with an iRating; null when none. */
  sof: number | null;
  classSof: Record<string, number>;
}

/** What the Deriver passes in (the same references the relative gap uses). */
export interface StandingsInputs {
  carReference(carIdx: number): GapReferenceLap | undefined;
  /** `classKey` is the car's classId string ("" for none); LMU class ids are names. */
  trackReference(classKey: string): GapReferenceLap | undefined;
  averageLapS(carIdx: number): number | undefined;
  bestLapS(carIdx: number): number | undefined;
  classBestLapS(classKey: string): number | undefined;
  sessionBestLapS(): number | undefined;
}
