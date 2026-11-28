import type { Car, SessionPhase, SimState } from "../../model";
import { cornersFor, type Corner } from "../../track/corners";
import { trackKeyOf } from "../../track/track-key";
import { cornerAt } from "../incidents/tracker";
import { STOPPED_MPS, type SlowCarEstimate } from "../slow-car";
import { INCIDENT_AHEAD_RANGE_M, type IncidentAhead, type IncidentAheadKind } from "./types";

/** A car must stay slow this long before it counts as an incident, seconds. */
export const SLOW_TRIGGER_S = 1;
/** A car must stay off track this long before it counts, seconds (a kerb flicker is not one). */
export const OFF_TRIGGER_S = 0.5;
/**
 * A car that stops counting (back up to speed, back on track) is still reported this long, so
 * the warning does not flicker while it recovers, seconds.
 */
export const CLEAR_HOLD_S = 1;

const QUIET_PHASES: ReadonlySet<SessionPhase> = new Set([
  "garage",
  "gridding",
  "formation",
  "cooldown",
]);

interface Seen {
  kind: IncidentAheadKind;
  stopped: boolean;
  /** Last tick at which the car counted. */
  atS: number;
}

function onCircuit(car: Car): boolean {
  return (
    car.connected &&
    car.isPaceCar !== true &&
    car.isOnTrack !== false &&
    car.onPitRoad !== true &&
    car.inPitStall !== true &&
    car.trackSurface !== "notInWorld"
  );
}

/**
 * Finds the nearest incident ahead of the player: a car that is slow or stopped on track (from
 * the slow-car detector's speed estimates, so it works wherever lap positions do) or, where the
 * sim gives other cars' track surface (iRacing), off track. Cars in the pits and the player are
 * left out. A car must be slow for {@link SLOW_TRIGGER_S} or off for {@link OFF_TRIGGER_S}
 * before it counts and keeps counting {@link CLEAR_HOLD_S} after it recovers. Stateful and free
 * of timers; call `reset` on a new session.
 */
export class IncidentAheadTracker {
  private readonly cornersOf: (trackKey: string | null) => readonly Corner[];
  private readonly offSince = new Map<number, number>();
  private readonly seen = new Map<number, Seen>();
  private cornerKey: string | null = null;
  private corners: readonly Corner[] = [];

  /** `corners` looks up a track's corner list (default: ours, see track/corners). */
  constructor(options: { corners?: (trackKey: string | null) => readonly Corner[] } = {}) {
    this.cornersOf = options.corners ?? ((key) => cornersFor(key)?.corners ?? []);
  }

  reset(): void {
    this.offSince.clear();
    this.seen.clear();
    this.cornerKey = null;
    this.corners = [];
  }

  /** `slow` is the slow-car detector's list for the same tick (`SlowCarDetector.slowCars`). */
  next(state: SimState, slow: readonly SlowCarEstimate[]): IncidentAhead | null {
    const t = state.tickTimeS;
    const lengthM = state.session.trackLengthM;
    const phase = state.session.phase;
    if (!state.connected || t === null || lengthM === null || lengthM <= 0) return null;
    if (phase === null || QUIET_PHASES.has(phase)) {
      this.offSince.clear();
      this.seen.clear();
      return null;
    }

    const slowOf = new Map(slow.map((s) => [s.carIdx, s]));
    const cars = new Map<number, Car>();
    for (const car of state.cars) {
      if (car.carIdx === state.playerCarIdx || !onCircuit(car)) continue;
      cars.set(car.carIdx, car);
      if (car.trackSurface === "offTrack") {
        if (!this.offSince.has(car.carIdx)) this.offSince.set(car.carIdx, t);
      } else this.offSince.delete(car.carIdx);
      const est = slowOf.get(car.carIdx);
      const slowEst = est !== undefined && est.slowForS >= SLOW_TRIGGER_S ? est : null;
      const off = t - (this.offSince.get(car.carIdx) ?? Infinity) >= OFF_TRIGGER_S;
      if (!off && slowEst === null) continue;
      const stopped = slowEst !== null && slowEst.speedMps < STOPPED_MPS;
      const kind: IncidentAheadKind = off ? "off" : stopped ? "stopped" : "slow";
      this.seen.set(car.carIdx, { kind, stopped, atS: t });
    }
    for (const idx of [...this.offSince.keys()]) if (!cars.has(idx)) this.offSince.delete(idx);
    for (const [idx, s] of [...this.seen]) {
      if (!cars.has(idx) || t - s.atS > CLEAR_HOLD_S || t < s.atS) this.seen.delete(idx);
    }

    const player = state.cars.find((c) => c.carIdx === state.playerCarIdx) ?? null;
    if (player === null || player.lapDistPct === null || !onCircuit(player)) return null;

    let best: IncidentAhead | null = null;
    for (const [idx, s] of this.seen) {
      const car = cars.get(idx)!;
      if (car.lapDistPct === null) continue;
      const distanceM = ((((car.lapDistPct - player.lapDistPct) % 1) + 1) % 1) * lengthM;
      if (distanceM <= 0 || distanceM > INCIDENT_AHEAD_RANGE_M) continue;
      if (best !== null && distanceM >= best.distanceM) continue;
      best = {
        carIdx: idx,
        carNumber: car.carNumber,
        distanceM,
        kind: s.kind,
        stopped: s.stopped,
        corner: null,
      };
    }
    if (best === null) return null;
    const pct = cars.get(best.carIdx)!.lapDistPct;
    return { ...best, corner: cornerAt(this.cornerList(state), pct) };
  }

  private cornerList(state: SimState): readonly Corner[] {
    const key = trackKeyOf(state);
    if (key !== this.cornerKey) {
      this.cornerKey = key;
      this.corners = this.cornersOf(key);
    }
    return this.corners;
  }
}
