import type { Car, SimState } from "../model";

/** Where the pit-exit line of each track is kept between runs; the telemetry process supplies the file. */
export interface PitExitStore {
  /** Lap-distance fraction 0..1 of the exit, or null when none is known. */
  load(trackKey: string): number | null;
  save(trackKey: string, lapDistPct: number): void;
}

/** The car must be at least this fast (m/s) when it leaves pit road, so a reset to the track is not taken for an exit. */
const MIN_EXIT_SPEED_MPS = 3;
/** Between two ticks the car may not jump further than this fraction of a lap. */
const MAX_STEP_PCT = 0.02;

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/**
 * Learns the lap-distance fraction where the player's `OnPitRoad` turns from true to false: the
 * pit exit. Remembers the first clean one per track.
 */
export class PitExitLearner {
  private lastOnPitRoad = false;
  private lastPct: number | null = null;

  /** The new exit to store, or null when this tick learned nothing. */
  update(state: SimState, player: Car | null, known: number | null): number | null {
    const pct = player?.lapDistPct ?? null;
    const onPitRoad = player?.onPitRoad === true;
    const wasOnPitRoad = this.lastOnPitRoad;
    const before = this.lastPct;
    this.lastOnPitRoad = onPitRoad;
    this.lastPct = pct === null || !Number.isFinite(pct) ? null : pct;
    if (known !== null || !wasOnPitRoad || onPitRoad || this.lastPct === null || before === null) {
      return null;
    }
    const step = ((this.lastPct - before + 1.5) % 1) - 0.5;
    if (step < 0 || step > MAX_STEP_PCT) return null;
    const speed = state.player.speedMps;
    if (speed === null || speed < MIN_EXIT_SPEED_MPS) return null;
    if (player?.isOnTrack === false) return null;
    return round5(this.lastPct);
  }

  /** Forget the previous tick, e.g. when the track changes. */
  reset(): void {
    this.lastOnPitRoad = false;
    this.lastPct = null;
  }
}

/** Metres from `fromPct` forward to `toPct`, wrapped; null when any input is unknown. */
export function distanceAheadM(
  fromPct: number | null,
  toPct: number | null,
  trackLengthM: number | null,
): number | null {
  if (fromPct === null || toPct === null || trackLengthM === null) return null;
  if (!Number.isFinite(fromPct) || !Number.isFinite(toPct) || !Number.isFinite(trackLengthM)) {
    return null;
  }
  return ((((toPct - fromPct) % 1) + 1) % 1) * trackLengthM;
}
