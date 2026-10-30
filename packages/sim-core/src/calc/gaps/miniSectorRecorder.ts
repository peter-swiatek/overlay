import {
  GAP_MINI_SECTOR_COUNT,
  type GapCarTick,
  type GapCompletedLap,
  type GapRecorderJson,
  type GapReferenceJson,
  type GapReferenceLap,
} from "./types";

const POINTS = GAP_MINI_SECTOR_COUNT + 1;
/** A forward jump larger than this between ticks is a teleport, not driving. */
const MAX_FORWARD_STEP = 0.1;

interface CarState {
  classId: number;
  /** -1 until the car is (again) in the world. */
  lastPct: number;
  lastTimeS: number;
  lap: number;
  /** Elapsed time at each boundary; NaN until crossed. */
  times: Float64Array;
  lapStartS: number;
  /** True once the car has been seen crossing S/F, so the lap has a real start. */
  fullLap: boolean;
  dirty: boolean;
}

function freeze(times: Float64Array, lapTimeS: number): GapReferenceLap {
  return { lapTimeS, times: Array.from(times) };
}

function parseReference(json: GapReferenceJson): GapReferenceLap | undefined {
  const { lapTimeS, times } = json;
  if (!Number.isFinite(lapTimeS) || lapTimeS <= 0 || !Array.isArray(times)) return undefined;
  if (times.length !== POINTS || !times.every((t) => Number.isFinite(t))) return undefined;
  return { lapTimeS, times: [...times] };
}

/**
 * Records elapsed lap time at 200 points per lap for every car and keeps a reference lap per
 * car plus a best-clean-lap track reference per class.
 */
export class MiniSectorRecorder {
  private readonly cars = new Map<number, CarState>();
  private readonly carReferences = new Map<number, GapReferenceLap>();
  private readonly trackReferences = new Map<number, GapReferenceLap>();

  /** Feed one car tick. Returns the lap this tick completed, if it ran from S/F to S/F. */
  update(tick: GapCarTick): GapCompletedLap | undefined {
    const classId = tick.classId ?? 0;
    const pct = tick.lapDistPct;
    const state = this.cars.get(tick.carIdx);
    const inWorld =
      Number.isFinite(pct) && pct >= 0 && pct <= 1 && Number.isFinite(tick.sessionTimeS);
    const bad = tick.onPitRoad || tick.offTrack || !inWorld;

    if (!inWorld) {
      if (state) {
        state.dirty = true;
        state.lastPct = -1;
      }
      return undefined;
    }
    if (!state || state.lastPct < 0) {
      this.startCar(tick, classId, bad, state);
      return undefined;
    }
    state.classId = classId;
    if (tick.sessionTimeS <= state.lastTimeS) return undefined;
    if (bad) state.dirty = true;

    const delta = pct - state.lastPct;
    if (delta < -0.5) return this.crossLine(tick, state, bad);
    if (delta > MAX_FORWARD_STEP) {
      // Teleport (reset to pits, reverse across the line, big data gap): nothing here is trustworthy.
      state.dirty = true;
      state.lastPct = pct;
    } else if (delta > 0) {
      this.recordPoints(state, state.lastPct, pct, state.lastTimeS, tick.sessionTimeS);
      state.lastPct = pct;
    }
    state.lastTimeS = tick.sessionTimeS;
    state.lap = tick.lap;
    return undefined;
  }

  /** The car's own reference lap (first clean lap, replaced by faster clean laps). */
  carReference(carIdx: number): GapReferenceLap | undefined {
    return this.carReferences.get(carIdx);
  }

  /** Best clean lap by any car of this class this session (or loaded from disk). */
  trackReference(classId = 0): GapReferenceLap | undefined {
    return this.trackReferences.get(classId);
  }

  toJSON(): GapRecorderJson {
    const trackReferences: Record<string, GapReferenceJson> = {};
    for (const [classId, ref] of this.trackReferences) {
      trackReferences[String(classId)] = { lapTimeS: ref.lapTimeS, times: [...ref.times] };
    }
    return { version: 1, trackReferences };
  }

  /** Rebuild a recorder with persisted track references. Invalid entries are dropped. */
  static fromJSON(json: unknown): MiniSectorRecorder {
    const recorder = new MiniSectorRecorder();
    if (typeof json !== "object" || json === null) return recorder;
    const parsed = json as Partial<GapRecorderJson>;
    if (parsed.version !== 1 || typeof parsed.trackReferences !== "object") return recorder;
    for (const [key, value] of Object.entries(parsed.trackReferences ?? {})) {
      const classId = Number(key);
      const ref = value ? parseReference(value) : undefined;
      if (Number.isInteger(classId) && ref) recorder.trackReferences.set(classId, ref);
    }
    return recorder;
  }

  private startCar(tick: GapCarTick, classId: number, bad: boolean, old: CarState | undefined) {
    this.cars.set(tick.carIdx, {
      classId,
      lastPct: tick.lapDistPct,
      lastTimeS: tick.sessionTimeS,
      lap: tick.lap,
      times: new Float64Array(POINTS).fill(NaN),
      lapStartS: NaN,
      fullLap: false,
      dirty: bad || old !== undefined,
    });
  }

  /** Record every point strictly after `from` up to and including `to` (point 200 is the lap time). */
  private recordPoints(state: CarState, from: number, to: number, t0: number, t1: number) {
    const first = Math.floor(from * GAP_MINI_SECTOR_COUNT) + 1;
    const last = Math.min(Math.floor(to * GAP_MINI_SECTOR_COUNT), GAP_MINI_SECTOR_COUNT - 1);
    for (let i = first; i <= last; i++) {
      const crossS = t0 + ((i / GAP_MINI_SECTOR_COUNT - from) / (to - from)) * (t1 - t0);
      state.times[i] = crossS - state.lapStartS;
    }
  }

  private crossLine(tick: GapCarTick, state: CarState, bad: boolean): GapCompletedLap | undefined {
    const pct = tick.lapDistPct;
    const span = 1 - state.lastPct + pct;
    const crossS =
      state.lastTimeS + ((1 - state.lastPct) / span) * (tick.sessionTimeS - state.lastTimeS);
    let completed: GapCompletedLap | undefined;
    if (state.fullLap) {
      this.recordPoints(state, state.lastPct, 1, state.lastTimeS, crossS);
      const lapTimeS = crossS - state.lapStartS;
      state.times[GAP_MINI_SECTOR_COUNT] = lapTimeS;
      const clean =
        !state.dirty && !bad && lapTimeS > 0 && state.times.every((t) => Number.isFinite(t));
      completed = { carIdx: tick.carIdx, classId: state.classId, lap: state.lap, lapTimeS, clean };
      if (clean) this.offerReference(tick.carIdx, state, lapTimeS);
    }
    // The new lap starts exactly at the line and runs on to the current position.
    state.times.fill(NaN);
    state.times[0] = 0;
    state.lapStartS = crossS;
    state.fullLap = true;
    state.dirty = bad;
    state.lap = tick.lap;
    this.recordPoints(state, 0, pct, crossS, tick.sessionTimeS);
    state.lastPct = pct;
    state.lastTimeS = tick.sessionTimeS;
    return completed;
  }

  private offerReference(carIdx: number, state: CarState, lapTimeS: number) {
    const own = this.carReferences.get(carIdx);
    if (!own || lapTimeS < own.lapTimeS) {
      this.carReferences.set(carIdx, freeze(state.times, lapTimeS));
    }
    const track = this.trackReferences.get(state.classId);
    if (!track || lapTimeS < track.lapTimeS) {
      this.trackReferences.set(state.classId, freeze(state.times, lapTimeS));
    }
  }
}
