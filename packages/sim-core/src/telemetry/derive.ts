import {
  estimateRaceLapsRemaining,
  FuelTracker,
  type FuelContext,
  type FuelOutputs,
  type FuelSample,
} from "../calc/fuel";
import { MiniSectorRecorder, RollingLapTimes, relativeGap, type GapCarTick } from "../calc/gaps";
import type { Car, SessionPhase, SessionType, SimState } from "../model";
import { TrackTracker, type TrackOutline, type TrackOutlineStore } from "../track";
import { emptyDerived, type Derived, type DerivedGap } from "./frame";

/** The clock going back by more than this means a new session or a restarted replay. */
const CLOCK_BACKWARDS_S = 1;

/** iRacing SessionState numbers, which FuelTracker expects. */
const SESSION_STATE: Partial<Record<SessionPhase, number>> = {
  formation: 3,
  racing: 4,
  checkered: 5,
  cooldown: 6,
};
const SESSION_STATE_OTHER = 1;

/**
 * Turns each {@link SimState} into {@link Derived} values. Stateful (calculators keep history)
 * and free of timers, so the same input sequence always gives the same output. The one I/O is
 * the optional track outline store: a synchronous read when the track changes, and a `save` that
 * the store must not block on.
 */
export interface DeriverOptions {
  /** Where track outlines are kept between runs; without it they live only in memory. */
  trackOutlines?: TrackOutlineStore;
  /** Clock for outline timestamps. */
  now?: () => Date;
}

export class Deriver {
  private readonly track: TrackTracker;
  private fuel = new FuelTracker();
  private recorder = new MiniSectorRecorder();
  private laps = new RollingLapTimes();
  private sessionCounter = 0;
  private lastType: SessionType | null = null;
  private lastTickS: number | null = null;
  private fuelSamples = 0;

  constructor(options: DeriverOptions = {}) {
    this.track = new TrackTracker({
      ...(options.trackOutlines ? { store: options.trackOutlines } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  /**
   * Forget everything. Call it when the source switches or a replay restarts; session changes
   * are detected by `next` itself.
   */
  reset(): void {
    this.fuel = new FuelTracker();
    this.recorder = new MiniSectorRecorder();
    this.laps = new RollingLapTimes();
    this.sessionCounter++;
    this.lastType = null;
    this.lastTickS = null;
    this.fuelSamples = 0;
    this.track.reset();
  }

  /** Number of resets so far; this is the `sessionNum` the fuel tracker sees. */
  get sessionNum(): number {
    return this.sessionCounter;
  }

  /** The fuel tracker, for tests that inspect lap records. */
  get fuelTracker(): FuelTracker {
    return this.fuel;
  }

  /** The outline of the track the player is on, once one is known. */
  get trackOutline(): TrackOutline | null {
    return this.track.current;
  }

  /** The key of the track being driven, when known. */
  get trackKey(): string | null {
    return this.track.trackKey;
  }

  /** The tracker, for tests that inspect why a lap was or was not used. */
  get trackTracker(): TrackTracker {
    return this.track;
  }

  next(state: SimState): Derived {
    if (!state.connected) return emptyDerived();
    this.detectSessionChange(state);
    const tickS = state.tickTimeS;
    const player = findPlayer(state);
    if (tickS !== null) this.recordCars(state, tickS);
    return {
      fuel: this.updateFuel(state, player, tickS),
      gaps: this.gaps(state, player),
      track: this.track.update(state, player),
    };
  }

  private detectSessionChange(state: SimState): void {
    const type = state.session.type;
    const tick = state.tickTimeS;
    // An unknown type (YAML not parsed yet) is not a change.
    const typeChanged = type !== null && this.lastType !== null && type !== this.lastType;
    const clockBack =
      tick !== null && this.lastTickS !== null && tick < this.lastTickS - CLOCK_BACKWARDS_S;
    if (typeChanged || clockBack) this.reset();
    if (type !== null) this.lastType = type;
    if (tick !== null) this.lastTickS = tick;
  }

  private recordCars(state: SimState, tickS: number): void {
    for (const car of state.cars) {
      if (car.isPaceCar === true) continue;
      const classId = Number(car.classId) || 0;
      const done = this.recorder.update(carTick(car, tickS, classId));
      if (done) this.laps.record(car.carIdx, done.lapTimeS, done.clean, classId);
    }
  }

  private updateFuel(
    state: SimState,
    player: Car | null,
    tickS: number | null,
  ): FuelOutputs | null {
    const sample = player === null ? null : fuelSample(state, player, tickS, this.sessionCounter);
    if (sample !== null) {
      this.fuel.update(sample);
      this.fuelSamples++;
    }
    if (this.fuelSamples === 0 || player === null) return null;
    return this.fuel.snapshot(this.fuelContext(state, player));
  }

  private fuelContext(state: SimState, player: Car): FuelContext {
    return {
      lapsToGo: this.lapsToGo(state, player),
      tankCapacityL: state.player.fuelCapacityL,
    };
  }

  private lapsToGo(state: SimState, player: Car): number | null {
    const s = state.session;
    const done = player.lapsCompleted;
    const pct = player.lapDistPct;
    if (done === null || pct === null) return null;
    if (s.timing === "laps" && s.lapsTotal !== null) return s.lapsTotal - done - pct;
    const avgLapS = this.laps.average(player.carIdx) ?? player.bestLapS ?? player.lastLapS ?? null;
    if (s.timeRemainingS !== null && avgLapS !== null) {
      return estimateRaceLapsRemaining(s.timeRemainingS, avgLapS, pct);
    }
    return s.lapsTotal === null ? null : s.lapsTotal - done - pct;
  }

  private gaps(state: SimState, player: Car | null): DerivedGap[] {
    const out: DerivedGap[] = [];
    for (const car of state.cars) {
      if (car.isPaceCar === true || car.carIdx === state.playerCarIdx) continue;
      const pct = car.lapDistPct;
      if (player === null || player.lapDistPct === null || pct === null) {
        out.push({ carIdx: car.carIdx, gapS: null, tier: "unavailable" });
        continue;
      }
      const classId = Number(car.classId) || 0;
      const result = relativeGap(
        { carIdx: player.carIdx, lapDistPct: player.lapDistPct },
        { carIdx: car.carIdx, lapDistPct: pct },
        {
          targetReference: this.recorder.carReference(car.carIdx),
          trackReference: this.recorder.trackReference(classId),
          lapTimes: {
            targetAverageS: this.laps.average(car.carIdx),
            targetBestS: this.laps.best(car.carIdx),
            classBestS: this.laps.classBest(classId),
            sessionBestS: this.laps.sessionBest(),
          },
        },
      );
      out.push({
        carIdx: car.carIdx,
        gapS: result.tier === "unavailable" ? null : result.gapS,
        tier: result.tier,
      });
    }
    return out;
  }
}

function findPlayer(state: SimState): Car | null {
  if (state.playerCarIdx === null) return null;
  return state.cars.find((c) => c.carIdx === state.playerCarIdx) ?? null;
}

function carTick(car: Car, sessionTimeS: number, classId: number): GapCarTick {
  return {
    sessionTimeS,
    carIdx: car.carIdx,
    lap: car.lapsCompleted ?? 0,
    // A negative pct tells the recorder the car is not in the world.
    lapDistPct: car.connected && car.lapDistPct !== null ? car.lapDistPct : -1,
    onPitRoad: car.onPitRoad === true,
    offTrack: car.isOnTrack === false,
    classId,
  };
}

function fuelSample(
  state: SimState,
  car: Car,
  tickS: number | null,
  sessionNum: number,
): FuelSample | null {
  const fuelL = state.player.fuelL;
  if (tickS === null || fuelL === null || car.lapDistPct === null) return null;
  const phase = state.session.phase;
  return {
    sessionTimeS: tickS,
    sessionNum,
    sessionState: (phase === null ? undefined : SESSION_STATE[phase]) ?? SESSION_STATE_OTHER,
    // iRacing reports no completed-lap count before the first S/F crossing (the adapter turns its
    // -1 into null); feeding -1 back lets that first crossing count as one counter tick.
    lap: car.lapsCompleted ?? -1,
    lapDistPct: car.lapDistPct,
    fuelL,
    onPitRoad: car.onPitRoad === true,
    inPitStall: car.inPitStall === true,
    isPaceLap: phase === "formation",
    sessionType: state.session.type ?? "other",
  };
}
