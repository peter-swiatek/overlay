import {
  estimateRaceLapsRemaining,
  fuelHistoryKey,
  FuelTracker,
  type FuelContext,
  type FuelHistoryKind,
  type FuelHistoryStore,
  type FuelOutputs,
  type FuelSample,
  type FuelTrackerOptions,
} from "../calc/fuel";
import { DeltaTracker, deltaInput, type BestLapStore } from "../calc/delta";
import { LapHistoryTracker, lapHistoryInput } from "../calc/laps";
import {
  MiniSectorRecorder,
  RollingLapTimes,
  lapDelta,
  relativeGap,
  type GapCarTick,
} from "../calc/gaps";
import { ProximityTracker } from "../calc/proximity";
import { SlowCarDetector } from "../calc/slow-car";
import { StandingsTracker, type StandingsInputs } from "../calc/standings";
import { TyreStintTracker, tyreStintInput } from "../calc/tyres";
import type { Car, SessionPhase, SessionType, SimState } from "../model";
import {
  TrackTracker,
  trackKeyOf,
  type PitExitStore,
  type TrackOutline,
  type TrackOutlineStore,
} from "../track";
import { emptyDerived, type Derived, type DerivedGap } from "./frame";

/** The clock going back by more than this means a new session or a restarted replay. */
const CLOCK_BACKWARDS_S = 1;

/**
 * Turns each {@link SimState} into {@link Derived} values. Stateful (calculators keep history)
 * and free of timers, so the same input sequence always gives the same output. The one I/O is
 * the optional track outline store: a synchronous read when the track changes, and a `save` that
 * the store must not block on.
 */
export interface DeriverOptions {
  /** Where track outlines are kept between runs; without it they live only in memory. */
  trackOutlines?: TrackOutlineStore;
  /** Where the learned pit-exit line of each track is kept; without it it lives only in memory. */
  pitExits?: PitExitStore;
  /** Clock for outline timestamps. */
  now?: () => Date;
  /** Fuel use of earlier sessions; without it nothing is recorded or seeded. */
  fuelHistory?: FuelHistoryStore;
  /** All-time best laps per car and track; without it they live only in memory. */
  bestLaps?: BestLapStore;
}

export class Deriver {
  private readonly track: TrackTracker;
  private recorder = new MiniSectorRecorder();
  private laps = new RollingLapTimes();
  private sessionCounter = 0;
  private lastType: SessionType | null = null;
  private lastTickS: number | null = null;
  private readonly standings = new StandingsTracker();
  private readonly proximity = new ProximityTracker();
  private readonly slowCars = new SlowCarDetector();
  private readonly delta: DeltaTracker;
  private readonly lapHistory = new LapHistoryTracker();
  private readonly tyreStint = new TyreStintTracker();

  private readonly classIndices = new Map<string, number>();

  constructor(options: DeriverOptions = {}) {
    this.fuelHistory = options.fuelHistory ?? null;
    this.delta = new DeltaTracker({ store: options.bestLaps ?? null });
    this.track = new TrackTracker({
      ...(options.trackOutlines ? { store: options.trackOutlines } : {}),
      ...(options.pitExits ? { pitExits: options.pitExits } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  /**
   * Forget everything. Call it when the source switches or a replay restarts; session changes
   * are detected by `next` itself.
   */
  reset(): void {
    this.resetFuel();
    this.recorder = new MiniSectorRecorder();
    this.laps = new RollingLapTimes();
    this.sessionCounter++;
    this.lastType = null;
    this.lastTickS = null;
    this.standings.reset();
    this.proximity.reset();
    this.slowCars.reset();
    this.delta.reset();
    this.lapHistory.reset();
    this.tyreStint.reset();
    this.track.reset();
    this.classIndices.clear();
  }

  /** Stable per-session class number: 0 for "", then 1, 2, ... in order of first sight. */
  classIndex(key: string): number {
    if (key === "") return 0;
    let index = this.classIndices.get(key);
    if (index === undefined) {
      index = this.classIndices.size + 1;
      this.classIndices.set(key, index);
    }
    return index;
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
    const fuel = this.updateFuel(state, player, tickS);
    const standings = this.standings.next(state, this.standingsInputs());
    return {
      fuel,
      gaps: this.gaps(state, player),
      track: this.track.update(state, player),
      standings,
      proximity: this.proximity.next(state),
      delta: this.delta.next(deltaInput(state, player)),
      slowCar: this.slowCars.next(state),
      energy: this.updateEnergy(state, player, tickS),
      laps: this.lapHistory.next(
        lapHistoryInput(state, standings, player === null ? null : this.fuel.lapRecords),
      ),
      tyreStint: this.tyreStint.next(tyreStintInput(state)),
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
      const classId = this.classIndex(car.classId ?? "");
      const done = this.recorder.update(carTick(car, tickS, classId));
      if (done) this.laps.record(car.carIdx, done.lapTimeS, done.clean, classId);
    }
  }

  // --- fuel and energy (M2-10) ---

  private fuel = new FuelTracker();
  private fuelSamples = 0;
  private fuelLink = newHistoryLink();

  private readonly fuelHistory: FuelHistoryStore | null;
  private keepFuelData = false;

  /** Same bookkeeping on LMU's virtual energy, in percent. */
  private energy = new FuelTracker(ENERGY_OPTIONS);
  private energySamples = 0;
  private energyLink = newHistoryLink();

  /** The energy tracker, for tests that inspect lap records. */
  get energyTracker(): FuelTracker {
    return this.energy;
  }

  /**
   * Keep fuel data: seed the trackers with the last laps in this car at this track until the
   * session has 2 valid laps of its own. Takes effect on the next tick; laps are recorded either way.
   */
  setKeepFuelData(on: boolean): void {
    this.keepFuelData = on;
  }

  private resetFuel(): void {
    this.fuel = new FuelTracker();
    this.fuelSamples = 0;
    this.fuelLink = newHistoryLink();
    this.energy = new FuelTracker(ENERGY_OPTIONS);
    this.energySamples = 0;
    this.energyLink = newHistoryLink();
  }

  /**
   * Finds the history key and seeds on a key change or when the option flips. `load` runs only
   * then; per tick this is a key build and two compares. Null when nothing is kept.
   */
  private seedHistory(
    kind: FuelHistoryKind,
    tracker: FuelTracker,
    link: HistoryLink,
    state: SimState,
    player: Car,
  ): string | null {
    const store = this.fuelHistory;
    if (store === null) return null;
    const key = fuelHistoryKey(
      kind,
      state.sim,
      player.carName,
      trackKeyOf(state),
      player.className,
    );
    if (key !== link.key) {
      link.key = key;
      link.seeded = false;
    }
    const want = this.keepFuelData && key !== null;
    if (want && !link.seeded) {
      tracker.seed(store.load(key));
      link.seeded = true;
    } else if (!want && link.seeded) {
      tracker.seed([]);
      link.seeded = false;
    }
    return key;
  }

  /** Records each valid lap that closed since the last tick; invalid laps never. */
  private recordHistory(
    tracker: FuelTracker,
    link: HistoryLink,
    key: string | null,
    state: SimState,
    out: FuelOutputs,
  ): void {
    const records = tracker.lapRecords;
    // A session reset restarts the record list; a lap that closes on the same tick as the reset
    // is then record 0 of the new list and must still be recorded.
    if (tracker.resetCount !== link.epoch) {
      link.epoch = tracker.resetCount;
      link.records = 0;
    }
    if (records.length <= link.records) {
      link.records = Math.min(link.records, records.length);
      return;
    }
    const store = this.fuelHistory;
    const live = state.source !== "replay" && state.source !== "mock";
    if (store !== null && key !== null && live) {
      for (let i = link.records; i < records.length; i++) {
        const rec = records[i]!;
        if (!rec.valid) continue;
        const lapTimeS =
          out.recentLaps.find((l) => l.lapNumber === rec.lapNumber)?.lapTimeS ?? null;
        store.record(key, { used: rec.usedL, lapTimeS });
      }
    }
    link.records = records.length;
  }

  private updateFuel(
    state: SimState,
    player: Car | null,
    tickS: number | null,
  ): FuelOutputs | null {
    const sample =
      player === null
        ? null
        : fuelSample(state, player, tickS, this.sessionCounter, state.player.fuelL);
    if (sample !== null) {
      this.fuel.update(sample);
      this.fuelSamples++;
    }
    if (this.fuelSamples === 0 || player === null) return null;
    const key = this.seedHistory("fuel", this.fuel, this.fuelLink, state, player);
    const out = this.fuel.snapshot(this.fuelContext(state, player));
    this.recordHistory(this.fuel, this.fuelLink, key, state, out);
    return out;
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

  /** LMU virtual energy through the fuel calculator, in percent; null when the car has none. */
  private updateEnergy(
    state: SimState,
    player: Car | null,
    tickS: number | null,
  ): FuelOutputs | null {
    const fraction = state.player.energyFraction;
    if (player === null || fraction === null) return null;
    const sample = fuelSample(state, player, tickS, this.sessionCounter, fraction * 100);
    if (sample !== null) {
      this.energy.update(sample);
      this.energySamples++;
    }
    if (this.energySamples === 0) return null;
    const key = this.seedHistory("energy", this.energy, this.energyLink, state, player);
    const out = this.energy.snapshot({
      lapsToGo: this.lapsToGo(state, player),
      tankCapacityL: 100,
    });
    this.recordHistory(this.energy, this.energyLink, key, state, out);
    return out;
  }

  // --- end fuel and energy ---

  private gaps(state: SimState, player: Car | null): DerivedGap[] {
    const out: DerivedGap[] = [];
    // Lap counts only rank cars in a race; in practice or qualifying they say nothing.
    const race = state.session.type === "race";
    for (const car of state.cars) {
      if (car.isPaceCar === true || car.carIdx === state.playerCarIdx) continue;
      const pct = car.lapDistPct;
      if (player === null || player.lapDistPct === null || pct === null) {
        out.push({ carIdx: car.carIdx, gapS: null, tier: "unavailable", lapDelta: null });
        continue;
      }
      const classId = this.classIndex(car.classId ?? "");
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
        lapDelta: race && car.connected ? lapDelta(player, car) : null,
      });
    }
    return out;
  }
  private standingsInputs(): StandingsInputs {
    const { recorder, laps } = this;
    const classIndex = (key: string): number => this.classIndex(key);
    return {
      carReference: (carIdx) => recorder.carReference(carIdx),
      trackReference: (classKey) => recorder.trackReference(classIndex(classKey)),
      averageLapS: (carIdx) => laps.average(carIdx),
      bestLapS: (carIdx) => laps.best(carIdx),
      classBestLapS: (classKey) => laps.classBest(classIndex(classKey)),
      sessionBestLapS: () => laps.sessionBest(),
    };
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

// --- fuel sample (M2-10) ---

/** iRacing SessionState numbers, which FuelTracker expects. */
const SESSION_STATE: Partial<Record<SessionPhase, number>> = {
  formation: 3,
  racing: 4,
  checkered: 5,
  cooldown: 6,
};
const SESSION_STATE_OTHER = 1;

/** Thresholds in percent of a full virtual energy tank (see the LMU recording check). */
const ENERGY_OPTIONS: FuelTrackerOptions = {
  minLapUse: 0.5,
  maxLapUse: 50,
  pitRefuelJump: 0.5,
  refuelJump: 2,
};

function fuelSample(
  state: SimState,
  car: Car,
  tickS: number | null,
  sessionNum: number,
  fuelL: number | null,
): FuelSample | null {
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

/** Per tracker: the history key in force, whether it is seeded, and how many lap records are already handled. */
interface HistoryLink {
  key: string | null;
  seeded: boolean;
  records: number;
  /** FuelTracker.resetCount when `records` was counted. */
  epoch: number;
}

function newHistoryLink(): HistoryLink {
  return { key: null, seeded: false, records: 0, epoch: 0 };
}

// --- end fuel sample ---
