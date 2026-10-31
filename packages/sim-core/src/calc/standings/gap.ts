import {
  GAP_DEFAULT_LAP_TIME_S,
  GAP_MINI_SECTOR_COUNT,
  elapsedAt,
  type GapReferenceLap,
} from "../gaps";
import type { StandingsGap } from "./types";

function usable(value: number | null | undefined): value is number {
  return value !== undefined && value !== null && Number.isFinite(value) && value > 0;
}

export function usableReference(ref: GapReferenceLap | undefined): ref is GapReferenceLap {
  return (
    ref !== undefined && usable(ref.lapTimeS) && ref.times.length === GAP_MINI_SECTOR_COUNT + 1
  );
}

/** The reference lap-time chain: car average, car best, class best, session best, 90 s. */
export function lapTimeChain(
  average: number | null | undefined,
  best: number | null | undefined,
  classBest: number | null | undefined,
  sessionBest: number | null | undefined,
): number {
  for (const v of [average, best, classBest, sessionBest]) if (usable(v)) return v;
  return GAP_DEFAULT_LAP_TIME_S;
}

/**
 * Race gap of a car C behind a car A. `progress*` is lapsCompleted + lapDistPct, `pct*` the lap
 * fraction. Whole laps come from the progress difference; seconds are the time C needs to cover
 * from its lap position to A's on C's own reference lap (no half-lap wrap, unlike the relative
 * gap). The reference documents the reference-lap and lap-time-chain method for the relative gap; we
 * extend it to standings gaps. Without a reference the fraction is multiplied by `fallbackLapS`.
 */
export function raceGap(
  progressA: number,
  pctA: number,
  progressC: number,
  pctC: number,
  reference: GapReferenceLap | undefined,
  fallbackLapS: number,
): StandingsGap {
  const diff = Math.max(0, progressA - progressC);
  const laps = Math.floor(diff);
  if (usableReference(reference)) {
    let seconds = elapsedAt(reference, pctA) - elapsedAt(reference, pctC);
    if (seconds < 0) seconds += reference.lapTimeS;
    return { laps, seconds };
  }
  return { laps, seconds: (diff - laps) * fallbackLapS };
}

/** Non-race gap: the difference of best laps, null when either is unknown. */
export function bestLapGap(bestC: number | null, bestAhead: number | null): StandingsGap {
  if (bestC === null || bestAhead === null) return { laps: 0, seconds: null };
  return { laps: 0, seconds: bestC - bestAhead };
}
