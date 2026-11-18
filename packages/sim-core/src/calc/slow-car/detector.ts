import type { Car, SessionPhase, SimState } from "../../model";
import {
  SLOW_CAR_RANGE_M,
  SLOW_MPS,
  STOPPED_MPS,
  type SlowCarAhead,
  type SlowCarEstimate,
} from "./types";

/** How long the estimate must stay below {@link SLOW_MPS} before the car is reported, seconds. */
export const SLOW_FOR_S = 0.5;

/** Time constant of the speed smoothing, seconds. */
const SMOOTHING_S = 0.3;
/** More progress than this in one tick (a fraction of a lap) is a jump, not driving. */
const JUMP_LAP = 0.05;
/** After the phase turns to racing the detector stays quiet this long, seconds. */
export const RACE_START_QUIET_S = 5;
/** A gap in the clock longer than this loses the estimate, seconds. */
const MAX_DT_S = 1;

const QUIET_PHASES: ReadonlySet<SessionPhase> = new Set([
  "garage",
  "gridding",
  "formation",
  "cooldown",
]);

interface CarTrack {
  lastPct: number;
  lastTickS: number;
  /** Smoothed speed, m/s; null until two samples exist. */
  speedMps: number | null;
  /** Tick time at which the estimate first dropped below the slow limit; null while above. */
  slowSinceS: number | null;
  /** True once the estimate has been at or above the slow limit since this track began. */
  wasFast: boolean;
}

/** Wraps a lap-fraction difference into (-0.5, 0.5]. */
function wrapDiff(diff: number): number {
  let d = diff % 1;
  if (d > 0.5) d -= 1;
  else if (d <= -0.5) d += 1;
  return d;
}

/** Finds the nearest slow or stopped car ahead of the player. Stateful (speed estimates); no timers. */
export class SlowCarDetector {
  private readonly tracks = new Map<number, CarTrack>();
  /** True while the last phase seen was a quiet one (or none). */
  private wasQuiet = false;
  /** Tick time at which the phase turned to racing after a quiet phase; null when not applicable. */
  private racingSinceS: number | null = null;
  private slow: SlowCarEstimate[] = [];

  reset(): void {
    this.tracks.clear();
    this.slow = [];
    this.wasQuiet = false;
    this.racingSinceS = null;
  }

  /**
   * Every car the last `next` call holds as slow: seen fast since its estimate began and now
   * below {@link SLOW_MPS}, with how long it has been. The player and short dips are not taken
   * out; callers apply their own debounce. Empty in quiet phases and just after the start.
   */
  get slowCars(): readonly SlowCarEstimate[] {
    return this.slow;
  }

  next(state: SimState): SlowCarAhead | null {
    this.slow = [];
    const tickS = state.tickTimeS;
    const lengthM = state.session.trackLengthM;
    const phase = state.session.phase;
    if (tickS === null || lengthM === null || lengthM <= 0) return null;
    if (phase === null || QUIET_PHASES.has(phase)) {
      // A standing grid would otherwise look slow the moment the race starts.
      this.tracks.clear();
      this.wasQuiet = true;
      this.racingSinceS = null;
      return null;
    }
    if (this.wasQuiet) {
      this.wasQuiet = false;
      this.racingSinceS = tickS;
    }

    const seen = new Set<number>();
    for (const car of state.cars) {
      if (this.update(car, tickS, lengthM)) seen.add(car.carIdx);
    }
    for (const idx of [...this.tracks.keys()]) {
      if (!seen.has(idx)) this.tracks.delete(idx);
    }

    // Cars are still standing on the grid for a moment after the start.
    if (this.racingSinceS !== null && tickS - this.racingSinceS < RACE_START_QUIET_S) return null;

    for (const [carIdx, track] of this.tracks) {
      // A car that has never been seen fast is standing (grid, restart), not slowing.
      if (track.speedMps === null || track.slowSinceS === null || !track.wasFast) continue;
      this.slow.push({ carIdx, speedMps: track.speedMps, slowForS: tickS - track.slowSinceS });
    }

    const player = state.cars.find((c) => c.carIdx === state.playerCarIdx) ?? null;
    if (player === null || player.lapDistPct === null) return null;
    if (player.onPitRoad === true || player.inPitStall === true) return null;
    if (player.isOnTrack === false || player.trackSurface === "notInWorld") return null;

    let best: SlowCarAhead | null = null;
    for (const est of this.slow) {
      if (est.carIdx === player.carIdx || est.slowForS < SLOW_FOR_S) continue;
      const pct = state.cars.find((c) => c.carIdx === est.carIdx)?.lapDistPct ?? null;
      if (pct === null) continue;
      const distanceM = ((pct - player.lapDistPct + 1) % 1) * lengthM;
      if (distanceM <= 0 || distanceM > SLOW_CAR_RANGE_M) continue;
      if (best === null || distanceM < best.distanceM) {
        best = {
          carIdx: est.carIdx,
          distanceM,
          speedMps: est.speedMps,
          stopped: est.speedMps < STOPPED_MPS,
        };
      }
    }
    return best;
  }

  /** Updates one car's estimate; false when the car is not eligible (its estimate is dropped). */
  private update(car: Car, tickS: number, lengthM: number): boolean {
    const pct = car.lapDistPct;
    const eligible =
      car.connected &&
      pct !== null &&
      car.isPaceCar !== true &&
      car.isOnTrack !== false &&
      car.onPitRoad !== true &&
      car.inPitStall !== true &&
      car.trackSurface !== "notInWorld";
    if (!eligible) return false;

    const prev = this.tracks.get(car.carIdx);
    if (prev === undefined) {
      this.tracks.set(car.carIdx, fresh(pct, tickS));
      return true;
    }
    const dt = tickS - prev.lastTickS;
    if (dt === 0) return true;
    if (dt < 0) {
      this.tracks.set(car.carIdx, fresh(pct, tickS));
      return true;
    }
    const step = wrapDiff(pct - prev.lastPct);
    if (dt > MAX_DT_S || Math.abs(step) > JUMP_LAP) {
      this.tracks.set(car.carIdx, fresh(pct, tickS));
      return true;
    }
    const raw = (Math.max(0, step) * lengthM) / dt;
    const alpha = 1 - Math.exp(-dt / SMOOTHING_S);
    const speed = prev.speedMps === null ? raw : prev.speedMps + alpha * (raw - prev.speedMps);
    prev.speedMps = speed;
    prev.lastPct = pct;
    prev.lastTickS = tickS;
    if (speed < SLOW_MPS) prev.slowSinceS ??= tickS;
    else {
      prev.slowSinceS = null;
      prev.wasFast = true;
    }
    return true;
  }
}

function fresh(pct: number, tickS: number): CarTrack {
  return { lastPct: pct, lastTickS: tickS, speedMps: null, slowSinceS: null, wasFast: false };
}
