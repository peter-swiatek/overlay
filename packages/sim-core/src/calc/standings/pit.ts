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
  /**
   * Whether the car sat in its stall during the current pit-road visit: true once seen in the
   * stall, false when the sim said "not in stall" for the whole visit so far, null when unknown.
   */
  visitStall: boolean | null;
}

export function newPitHistory(): PitHistory {
  return {
    onPitRoad: null,
    sawTrack: false,
    pitStops: 0,
    lastPitLap: null,
    stintStartLap: null,
    prevStintLaps: null,
    visitStall: null,
  };
}

/**
 * Advances one car's history by a frame (mutates `h`).
 *
 * A stop is counted when onPitRoad goes true -> false, the car was seen on track before (or has
 * completed a lap), and it was in its stall during the visit. A drive-through is not a stop and
 * does not reset the stint. When the sim gives no stall information (`inPitStall` null for the
 * whole visit) a pit-road entry and exit counts. Frames where the car is not in the world are
 * ignored: a driver in the garage reports arbitrary pit-road values, and leaving the garage is not
 * a stop. Cars first seen mid-session start their stint at the first known lap.
 */
export function stepPit(
  h: PitHistory,
  onPitRoad: boolean | null,
  lapsCompleted: number | null,
  inWorld = true,
  inPitStall: boolean | null = null,
): void {
  if (h.stintStartLap === null && lapsCompleted !== null) h.stintStartLap = lapsCompleted;
  if (!inWorld) {
    // Whatever the pit-road flag says now, the next in-world frame starts from scratch.
    h.onPitRoad = null;
    h.sawTrack = false;
    return;
  }
  if (onPitRoad === null) return;
  if (onPitRoad) {
    if (h.onPitRoad !== true) h.visitStall = null;
    if (inPitStall === true) h.visitStall = true;
    else if (inPitStall === false && h.visitStall === null) h.visitStall = false;
  }
  if (h.onPitRoad === true && !onPitRoad) {
    if ((h.sawTrack || (lapsCompleted !== null && lapsCompleted >= 1)) && h.visitStall !== false) {
      h.pitStops += 1;
      if (lapsCompleted !== null) {
        h.lastPitLap = lapsCompleted;
        h.prevStintLaps = Math.max(0, lapsCompleted - (h.stintStartLap ?? lapsCompleted));
        h.stintStartLap = lapsCompleted;
      }
    }
    h.visitStall = null;
  }
  if (!onPitRoad) h.sawTrack = true;
  h.onPitRoad = onPitRoad;
}

export function stintLaps(h: PitHistory, lapsCompleted: number | null): number | null {
  if (lapsCompleted === null || h.stintStartLap === null) return null;
  return Math.max(0, lapsCompleted - h.stintStartLap);
}
