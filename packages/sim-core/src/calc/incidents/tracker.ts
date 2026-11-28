import type { Car, SimState, TrackSurface } from "../../model";
import { cornersFor, type Corner } from "../../track/corners";
import { trackKeyOf } from "../../track/track-key";
import {
  INCIDENT_LOG_MAX,
  type IncidentLogEvent,
  type IncidentLogKind,
  type IncidentLog,
} from "./types";

/**
 * A car must stay off track this long before the excursion is logged, seconds. Shorter dips
 * (a wheel over a kerb flickering the surface) are noise.
 */
export const OFF_TRACK_MIN_S = 0.3;
/**
 * A car that goes off again within this long of its last logged excursion is still in that
 * excursion (a spin across the grass, a slide back on and off), seconds.
 */
export const OFF_TRACK_GAP_S = 10;
/**
 * Incident points that arrive within this long of the player's previous increase join that
 * event. The sim upgrades an incident to a heavier one (a 1x off track that turns into a 2x
 * loss of control) by adding the difference, so the two increases are one event.
 */
export const POINTS_MERGE_S = 5;
/** An event just past a corner's end (most off-tracks happen on the exit) still names it, laps. */
const CORNER_EXIT_SLACK = 0.005;

/** The incident kind for an amount of points: 1x off track, 2x loss of control, 4x contact. */
export function kindOfPoints(points: number): IncidentLogKind {
  if (points === 1) return "off-track";
  if (points === 2) return "loss-of-control";
  if (points === 4) return "contact";
  return "incident";
}

/** 1-based sector containing `pct`; null without sector data or a position. */
export function sectorAt(starts: readonly number[] | null, pct: number | null): number | null {
  if (starts === null || starts.length === 0 || pct === null || !Number.isFinite(pct)) return null;
  let sector = 1;
  starts.forEach((s, i) => {
    if (pct >= s) sector = i + 1;
  });
  return sector;
}

function within(pct: number, start: number, end: number): boolean {
  const e = end % 1;
  return start <= e ? pct >= start && pct <= e : pct >= start || pct <= e;
}

/** The corner containing `pct`, else one that ended just before it; null when none. */
export function cornerAt(corners: readonly Corner[], pct: number | null): number | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const inside = corners.find((c) => within(pct, c.startPct, c.endPct));
  if (inside !== undefined) return inside.number;
  const exit = corners.find((c) => within(pct, c.startPct, c.endPct + CORNER_EXIT_SLACK));
  return exit?.number ?? null;
}

interface Place {
  timeS: number;
  lap: number | null;
  sector: number | null;
  corner: number | null;
}

interface CarWatch {
  prev: TrackSurface | null;
  /** An excursion that has not lasted {@link OFF_TRACK_MIN_S} yet. */
  pending: Place | null;
  /** The car is in an excursion that was logged (or belongs to one). */
  inExcursion: boolean;
  /** Last off-track tick of a logged excursion. */
  lastLoggedOffS: number | null;
}

/**
 * Builds the session's incident log from each tick:
 * - the player's incident count (iRacing): every increase is an event worth that many points,
 *   typed by the points, with increases close together merged (see {@link POINTS_MERGE_S});
 * - every car's track surface: going off track (and staying off for {@link OFF_TRACK_MIN_S}) is an
 *   "off-track" event without points. The player's own excursions are left to the incident count
 *   when the sim gives one, so they are not logged twice.
 * Stateful and free of timers; call `reset` on a new session.
 */
export class IncidentLogTracker {
  private readonly cornersOf: (trackKey: string | null) => readonly Corner[];
  private events: IncidentLogEvent[] = [];
  private nextId = 1;
  private prevCount: number | null = null;
  private countCarIdx: number | null = null;
  /** The player's newest points event and when its points last went up. */
  private lastOwn: { id: number; addedS: number } | null = null;
  private watches = new Map<number, CarWatch>();
  private cornerKey: string | null = null;
  private corners: readonly Corner[] = [];
  private output: IncidentLog | null = null;

  /** `corners` looks up a track's corner list (default: ours, see track/corners). */
  constructor(options: { corners?: (trackKey: string | null) => readonly Corner[] } = {}) {
    this.cornersOf = options.corners ?? ((key) => cornersFor(key)?.corners ?? []);
  }

  reset(): void {
    this.events = [];
    this.nextId = 1;
    this.prevCount = null;
    this.countCarIdx = null;
    this.lastOwn = null;
    this.watches.clear();
    this.cornerKey = null;
    this.corners = [];
    this.output = null;
  }

  next(state: SimState): IncidentLog | null {
    const t = state.tickTimeS;
    if (!state.connected || t === null || !Number.isFinite(t)) return this.output;
    this.ownPoints(state, t);
    this.offTracks(state, t);
    if (this.output === null) this.output = { events: this.events.slice() };
    return this.output;
  }

  private changed(): void {
    this.output = null;
  }

  private place(state: SimState, car: Car | undefined, t: number): Place {
    const pct = car?.lapDistPct ?? null;
    const done = car?.lapsCompleted ?? null;
    const lap = car?.lapInProgress ?? (done === null ? null : done + 1);
    return {
      timeS: t,
      lap,
      sector: sectorAt(state.session.sectorStartPcts, pct),
      corner: cornerAt(this.cornerList(state), pct),
    };
  }

  private cornerList(state: SimState): readonly Corner[] {
    const key = trackKeyOf(state);
    if (key !== this.cornerKey) {
      this.cornerKey = key;
      this.corners = this.cornersOf(key);
    }
    return this.corners;
  }

  private add(
    state: SimState,
    car: Car | undefined,
    carIdx: number,
    place: Place,
    kind: IncidentLogKind,
    points: number | null,
  ): IncidentLogEvent {
    const event: IncidentLogEvent = {
      id: this.nextId++,
      carIdx,
      carNumber: car?.carNumber ?? null,
      driverName: car?.driverName ?? null,
      ...place,
      kind,
      points,
      own: carIdx === state.playerCarIdx,
    };
    this.events.unshift(event);
    if (this.events.length > INCIDENT_LOG_MAX) this.events.length = INCIDENT_LOG_MAX;
    this.changed();
    return event;
  }

  // --- the player's incident points ---

  private ownPoints(state: SimState, t: number): void {
    const carIdx = state.playerCarIdx;
    const raw = state.player.incidentCount;
    if (carIdx === null || raw === null || !Number.isFinite(raw)) return;
    const count = Math.round(raw);
    const prev = this.prevCount;
    if (carIdx !== this.countCarIdx || prev === null || count < prev) {
      // A first count, another car or a count that went back: a new baseline, not an event.
      this.countCarIdx = carIdx;
      this.prevCount = count;
      this.lastOwn = null;
      return;
    }
    this.prevCount = count;
    const added = count - prev;
    if (added <= 0) return;
    const last = this.lastOwn;
    const index = last === null ? -1 : this.events.findIndex((e) => e.id === last.id);
    const merged = index >= 0 && last !== null && t - last.addedS <= POINTS_MERGE_S;
    if (merged) {
      const e = this.events[index]!;
      const points = (e.points ?? 0) + added;
      this.events[index] = { ...e, points, kind: kindOfPoints(points) };
      this.lastOwn = { id: e.id, addedS: t };
      this.changed();
      return;
    }
    const car = state.cars.find((c) => c.carIdx === carIdx);
    const e = this.add(state, car, carIdx, this.place(state, car, t), kindOfPoints(added), added);
    this.lastOwn = { id: e.id, addedS: t };
  }

  // --- off-track excursions ---

  private offTracks(state: SimState, t: number): void {
    const ownCounted = state.player.incidentCount !== null;
    for (const car of state.cars) {
      if (car.isPaceCar === true || !car.connected) continue;
      const own = car.carIdx === state.playerCarIdx;
      if (own && ownCounted) continue;
      const surface = (own ? state.player.trackSurface : null) ?? car.trackSurface;
      this.watchCar(state, car, surface, t);
    }
  }

  private watchCar(state: SimState, car: Car, surface: TrackSurface | null, t: number): void {
    let w = this.watches.get(car.carIdx);
    if (w === undefined) {
      w = { prev: null, pending: null, inExcursion: false, lastLoggedOffS: null };
      this.watches.set(car.carIdx, w);
    }
    if (surface === "offTrack") {
      const fromTrack = w.prev === "onTrack" || w.prev === "approachingPits";
      if (w.pending === null && !w.inExcursion && fromTrack) {
        const recent = w.lastLoggedOffS !== null && t - w.lastLoggedOffS <= OFF_TRACK_GAP_S;
        if (recent) w.inExcursion = true;
        else w.pending = this.place(state, car, t);
      }
      if (w.pending !== null && t - w.pending.timeS >= OFF_TRACK_MIN_S) {
        this.add(state, car, car.carIdx, w.pending, "off-track", null);
        w.pending = null;
        w.inExcursion = true;
      }
      if (w.inExcursion) w.lastLoggedOffS = t;
    } else {
      w.pending = null;
      w.inExcursion = false;
    }
    w.prev = surface;
  }
}
