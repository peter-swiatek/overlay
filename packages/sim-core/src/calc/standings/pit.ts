/** Per-car pit and stint history. */
export interface PitHistory {
  /** Last known onPitRoad; null until seen. */
  onPitRoad: boolean | null;
  /** Seen off pit road at some point (so a later entry came from the track). */
  sawTrack: boolean;
  pitStops: number;
  lastPitLap: number | null;
  /** lapsCompleted at the start of the current stint; null until a lap count is known. */
  stintStartLap: number | null;
  prevStintLaps: number | null;
}

export function newPitHistory(): PitHistory {
  return {
    onPitRoad: null,
    sawTrack: false,
    pitStops: 0,
    lastPitLap: null,
    stintStartLap: null,
    prevStintLaps: null,
  };
}

/**
 * Advances one car's history by a frame (mutates `h`).
 *
 * A stop is counted when onPitRoad goes true -> false and either the car was seen on track
 * before, or it has completed a lap. A car that starts in the garage or pit lane and simply
 * leaves is not a stop. A drive-through also counts: pit road was entered and left, and not every
 * sim reports the stall. Cars first seen mid-session start their stint at the first known lap.
 */
export function stepPit(
  h: PitHistory,
  onPitRoad: boolean | null,
  lapsCompleted: number | null,
): void {
  if (h.stintStartLap === null && lapsCompleted !== null) h.stintStartLap = lapsCompleted;
  if (onPitRoad === null) return;
  if (h.onPitRoad === true && !onPitRoad) {
    if (h.sawTrack || (lapsCompleted !== null && lapsCompleted >= 1)) {
      h.pitStops += 1;
      if (lapsCompleted !== null) {
        h.lastPitLap = lapsCompleted;
        h.prevStintLaps = Math.max(0, lapsCompleted - (h.stintStartLap ?? lapsCompleted));
        h.stintStartLap = lapsCompleted;
      }
    }
  }
  if (!onPitRoad) h.sawTrack = true;
  h.onPitRoad = onPitRoad;
}

export function stintLaps(h: PitHistory, lapsCompleted: number | null): number | null {
  if (lapsCompleted === null || h.stintStartLap === null) return null;
  return Math.max(0, lapsCompleted - h.stintStartLap);
}
