import type { Car, PlayerLapDeltas, SessionType, SimState, TrackSurface } from "../../model";
import { trackKeyOf } from "../../track";
import { carTrackKey } from "../fuel/history";
import { LapCleanliness } from "./clean";
import { OptimalLap } from "./optimal";
import { DeltaRate } from "./rate";
import { SectorTimer, type LapSectors, type SectorReference } from "./sectors";
import { autoReferenceKind } from "./select";
import { computedDelta, LapTraceRecorder, traceSpeedAt } from "./trace";
import type {
  BestLapRecord,
  BestLapStore,
  BestTime,
  DeltaOutputs,
  DeltaReferenceKind,
  DeltaReferenceLap,
  LapCompletion,
  LapTrace,
  LiveDelta,
} from "./types";

/** Lap fraction from which the snapshot is taken and best-time deltas are hidden. */
export const CLOSING_PCT = 0.97;
/** Longest wait for the sim to report the last lap time after the line, seconds. */
export const LAP_TIME_WAIT_S = 3;
/** The lap-complete strip shows while the new lap is younger than this, seconds. */
export const LAP_COMPLETE_SHOW_S = 10;
/** A lap time that changed this recently before the line was seen belongs to the lap just ended, seconds. */
const TIME_FIRST_S = 0.5;

/** Times closer than this are equal, seconds. */
const TIE_S = 0.0005;
/** A lap-fraction wrap of this size without a lap count change is the line seen early. */
const WRAP_FROM = 0.9;
const WRAP_TO = 0.1;
/** The sample at a crossing only belongs to the new lap when it is this close after the line. */
const CROSSING_MAX_PCT = 0.5;

const KINDS: readonly DeltaReferenceKind[] = [
  "allTimeBest",
  "sessionBestClean",
  "sessionBest",
  "lastLap",
];

/** What the tracker reads from one SimState (built by deltaInput). */
export interface DeltaTickInput {
  tickS: number;
  sessionType: SessionType | null;
  sessionTypeName: string | null;
  lapsCompleted: number | null;
  lapInProgress: number | null;
  lapDistPct: number | null;
  /** player.lap.currentLapS, else null (the tracker then measures from its own lap start). */
  currentLapS: number | null;
  lastLapS: number | null;
  /** The sim's own best lap (player.lap.bestLapS). */
  simBestLapS: number | null;
  /** player.lap.delta; null for sims without channels. */
  channels: PlayerLapDeltas | null;
  speedMps: number | null;
  incidentCount: number | null;
  trackSurface: TrackSurface | null;
  onPitRoad: boolean;
  inPitStall: boolean;
  /** carTrackKey of the player's car and track; null when unknown. */
  bestLapKey: string | null;
  /** Live source (not replay or mock): only then is the store written. */
  record: boolean;
  /** session.sectorStartPcts: the track's official sector starts; null without sector data. */
  sectorStartPcts?: readonly number[] | null;
}

let keyMemo: { args: string; key: string | null } | null = null;

function bestLapKeyOf(state: SimState, player: Car): string | null {
  const s = state.session;
  const args = `${state.sim}|${s.trackName}|${s.trackConfig}|${s.trackLengthM}|${player.carName}|${player.className}`;
  if (keyMemo !== null && keyMemo.args === args) return keyMemo.key;
  const key = carTrackKey(state.sim, player.carName, trackKeyOf(state), player.className);
  keyMemo = { args, key };
  return key;
}

/** Null when there is no player car or no lap data (player.lap null). */
export function deltaInput(state: SimState, player: Car | null): DeltaTickInput | null {
  const lap = state.player.lap;
  if (player === null || lap === null || state.tickTimeS === null) return null;
  return {
    tickS: state.tickTimeS,
    sessionType: state.session.type,
    sessionTypeName: state.session.typeName,
    lapsCompleted: player.lapsCompleted,
    lapInProgress: player.lapInProgress,
    lapDistPct: player.lapDistPct,
    currentLapS: lap.currentLapS,
    lastLapS: lap.lastLapS,
    simBestLapS: lap.bestLapS,
    channels: lap.delta,
    speedMps: state.player.speedMps,
    incidentCount: state.player.incidentCount,
    trackSurface: state.player.trackSurface,
    onPitRoad: player.onPitRoad === true,
    inPitStall: player.inPitStall === true,
    bestLapKey: bestLapKeyOf(state, player),
    record: state.source !== "replay" && state.source !== "mock",
    sectorStartPcts: state.session.sectorStartPcts,
  };
}

interface TimedLap {
  lapTimeS: number;
  trace: LapTrace | null;
}

interface Snapshot {
  refs: Partial<Record<DeltaReferenceKind, number>>;
  autoKind: DeltaReferenceKind | null;
  allTimeS: number | null;
  sessionS: number | null;
}

interface Pending {
  lapNumber: number;
  trace: LapTrace | null;
  clean: boolean;
  touchedPitRoad: boolean;
  snapshot: Snapshot;
  crossedAtS: number;
  lastLapSBefore: number | null;
  /** The sim changed the last lap time just before the line was seen (the time came first). */
  timeFirst: boolean;
  /** The finished lap's official sectors, kept for the session bests once the lap resolves. */
  sectors: LapSectors | null;
}

interface LastDeltas {
  allTimeDeltaS: number | null;
  sessionDeltaS: number | null;
  allTimeSet: boolean;
  sessionSet: boolean;
}

function clamp1(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

function faster(candidate: number, than: number | null): boolean {
  return than === null || candidate < than - TIE_S;
}

/**
 * The lap-by-lap state machine behind {@link DeltaOutputs}. One instance follows the player
 * through a session; feed it one {@link DeltaTickInput} per tick.
 */
export class DeltaTracker {
  private readonly store: BestLapStore | null;

  private key: string | null = null;
  private allTime: BestLapRecord | null = null;

  // Session laps.
  private last: TimedLap | null = null;
  private sessionBestLap: TimedLap | null = null;
  private sessionBestCleanLap: TimedLap | null = null;
  private optimal = new OptimalLap();
  private sectorTimer = new SectorTimer();

  // The lap in progress.
  private started = false;
  private recorder = new LapTraceRecorder();
  private forceBroken = false;
  private cleanliness = new LapCleanliness();
  private lapStartS = 0;
  private prevLapsCompleted: number | null = null;
  private prevPct: number | null = null;
  private prevTickS: number | null = null;
  private prevLastLapS: number | null = null;
  private lastLapChangedAtS: number | null = null;
  private snapshot: Snapshot | null = null;
  private closingLap = false;
  private rates = new Map<DeltaReferenceKind, DeltaRate>();

  private pending: Pending | null = null;
  private completion: LapCompletion | null = null;
  private lastDeltas: LastDeltas | null = null;

  constructor(options: { store?: BestLapStore | null } = {}) {
    this.store = options.store ?? null;
  }

  /** Session change or source switch: forget the session's laps (the store stays). */
  reset(): void {
    this.key = null;
    this.allTime = null;
    this.last = null;
    this.sessionBestLap = null;
    this.sessionBestCleanLap = null;
    this.optimal.reset();
    this.sectorTimer.reset();
    this.started = false;
    this.recorder.start();
    this.forceBroken = false;
    this.cleanliness = new LapCleanliness();
    this.prevLapsCompleted = null;
    this.prevPct = null;
    this.prevTickS = null;
    this.prevLastLapS = null;
    this.lastLapChangedAtS = null;
    this.snapshot = null;
    this.closingLap = false;
    this.rates.clear();
    this.pending = null;
    this.completion = null;
    this.lastDeltas = null;
  }

  next(input: DeltaTickInput | null): DeltaOutputs | null {
    if (input === null) return null;
    this.loadKey(input);
    this.sectorTimer.setTrack(input.sectorStartPcts ?? null);
    const lapNumber = this.lapNumberOf(input);
    this.advanceLap(input, lapNumber);
    this.resolvePending(input);
    this.seedFromSim(input);

    const elapsedS = this.elapsedOf(input);
    const refs = this.references(input);
    const live = this.liveDeltas(input, refs, elapsedS);
    const autoKind = autoReferenceKind({
      sessionType: input.sessionType,
      sessionTypeName: input.sessionTypeName,
      lapNumber,
      available: refs,
    });

    const hidden =
      this.closingLap ||
      this.pending !== null ||
      this.cleanliness.outLap ||
      this.completion === null ||
      this.lastDeltas === null;
    const sessionRef = refs.sessionBestClean ?? refs.sessionBest ?? null;
    const allTimeBest: BestTime = {
      lapTimeS: this.allTime?.lapTimeS ?? null,
      lastLapDeltaS: hidden ? null : (this.lastDeltas?.allTimeDeltaS ?? null),
      setByLastLap: this.lastDeltas?.allTimeSet ?? false,
    };
    const sessionBest: BestTime = {
      lapTimeS: sessionRef?.lapTimeS ?? null,
      lastLapDeltaS: hidden ? null : (this.lastDeltas?.sessionDeltaS ?? null),
      setByLastLap: this.lastDeltas?.sessionSet ?? false,
    };

    if (this.prevTickS !== null && input.lastLapS !== this.prevLastLapS) {
      this.lastLapChangedAtS = input.tickS;
    }
    this.prevTickS = input.tickS;
    this.prevLastLapS = input.lastLapS;
    this.prevLapsCompleted = input.lapsCompleted;

    return {
      references: refs,
      live,
      autoKind,
      lapNumber,
      currentLapS: elapsedS,
      lastLapS: input.lastLapS,
      outLap: this.cleanliness.outLap,
      closingLap: this.closingLap,
      currentLapClean: this.cleanliness.clean,
      allTimeBest,
      sessionBest,
      lastCompletion: this.completion,
      lapCompleteVisible: this.lapCompleteVisible(lapNumber, elapsedS, input),
      optimalLapS: this.optimal.lapS,
      sectors: this.sectorTimer.output(
        input.lapDistPct,
        elapsedS <= LAP_COMPLETE_SHOW_S,
        this.cleanliness.clean,
      ),
    };
  }

  // --- key and sim best (steps 1 and 2) ---

  private loadKey(input: DeltaTickInput): void {
    if (input.bestLapKey === null || input.bestLapKey === this.key) return;
    this.key = input.bestLapKey;
    this.allTime = this.store?.load(this.key) ?? null;
  }

  private seedFromSim(input: DeltaTickInput): void {
    const sim = input.simBestLapS;
    if (sim === null || !(sim > 0)) return;
    if (!faster(sim, this.allTime?.lapTimeS ?? null)) return;
    this.allTime = { lapTimeS: sim, trace: null };
    this.recordBest(input.record, this.allTime);
  }

  private recordBest(record: boolean, lap: BestLapRecord): void {
    if (record && this.key !== null && this.store !== null) this.store.record(this.key, lap);
  }

  // --- the lap in progress (steps 3 to 5) ---

  private lapNumberOf(input: DeltaTickInput): number | null {
    if (input.lapInProgress !== null) return input.lapInProgress;
    return input.lapsCompleted === null ? null : input.lapsCompleted + 1;
  }

  private elapsedOf(input: DeltaTickInput): number {
    return input.currentLapS ?? Math.max(0, input.tickS - this.lapStartS);
  }

  private cleanSample(input: DeltaTickInput) {
    return {
      incidentCount: input.incidentCount,
      trackSurface: input.trackSurface,
      onPitRoad: input.onPitRoad,
      inPitStall: input.inPitStall,
    };
  }

  /** Begins a lap at this tick. `atLine` laps can become references; others never do. */
  private startLap(input: DeltaTickInput, atLine: boolean): void {
    this.started = true;
    this.recorder.start();
    this.forceBroken = !atLine;
    this.lapStartS = input.tickS;
    this.cleanliness.start(this.cleanSample(input));
    this.snapshot = null;
    this.prevPct = null;
    this.closingLap = false;
    for (const r of this.rates.values()) r.reset();
  }

  private advanceLap(input: DeltaTickInput, lapNumber: number | null): void {
    const done = input.lapsCompleted;
    if (!this.started) {
      this.sectorTimer.dropLap();
      this.startLap(input, false);
      return;
    }
    const prev = this.prevLapsCompleted;
    if (done !== prev && done !== null) {
      if (prev !== null && done === prev + 1) {
        this.crossLine(input, lapNumber);
        return;
      }
      // A jump, a step back, or the first count of a session: the lap in progress is dropped.
      this.pending = null;
      this.sectorTimer.dropLap();
      this.startLap(input, prev === null && done === 0);
      return;
    }
    this.runLap(input);
  }

  private runLap(input: DeltaTickInput): void {
    const pct = input.lapDistPct;
    this.cleanliness.sample(this.cleanSample(input));
    if (pct === null) {
      this.forceBroken = true;
      this.sectorTimer.sample(null, 0, input.tickS, [], false);
      return;
    }
    const wrapped =
      this.prevPct !== null && this.prevPct > WRAP_FROM && pct < WRAP_TO && !this.forceBroken;
    if (wrapped) return; // the line was seen before the lap count moved
    this.prevPct = pct;
    this.sectorTimer.sample(
      pct,
      this.elapsedOf(input),
      input.tickS,
      this.sectorReferences(),
      this.cleanliness.clean,
    );
    if (!this.forceBroken) this.recorder.sample(pct, this.elapsedOf(input), input.speedMps);
    if (this.snapshot === null && pct >= CLOSING_PCT) {
      this.snapshot = this.takeSnapshot(input, this.lapNumberOf(input));
      this.closingLap = true;
    }
  }

  private crossLine(input: DeltaTickInput, lapNumber: number | null): void {
    // A crossing while the previous lap time is still outstanding closes it with what we have.
    if (this.pending !== null) this.resolvePending(input, true);
    const trace = this.forceBroken ? null : this.recorder.finish();
    const snapshot =
      this.snapshot ?? this.takeSnapshot(input, lapNumber === null ? null : lapNumber - 1);
    const finished = lapNumber !== null ? lapNumber - 1 : (this.prevLapsCompleted ?? 0) + 1;
    const sectors = this.sectorTimer.line(
      input.lapDistPct,
      input.tickS,
      this.sectorReferences(),
      this.cleanliness.clean,
    );
    this.pending = {
      lapNumber: finished,
      trace,
      clean: this.cleanliness.clean,
      touchedPitRoad: this.cleanliness.touchedPitRoad,
      snapshot,
      crossedAtS: input.tickS,
      lastLapSBefore: this.prevLastLapS,
      timeFirst:
        this.lastLapChangedAtS !== null && input.tickS - this.lastLapChangedAtS <= TIME_FIRST_S,
      sectors,
    };
    this.startLap(input, true);
    this.closingLap = true;
    const pct = input.lapDistPct;
    if (pct !== null && pct < CROSSING_MAX_PCT) {
      this.recorder.sample(pct, this.elapsedOf(input), input.speedMps);
      this.sectorTimer.sample(
        pct,
        this.elapsedOf(input),
        input.tickS,
        this.sectorReferences(),
        this.cleanliness.clean,
      );
    }
  }

  private takeSnapshot(input: DeltaTickInput, lapNumber: number | null): Snapshot {
    const refs = this.references(input);
    const out: Partial<Record<DeltaReferenceKind, number>> = {};
    for (const k of KINDS) {
      const r = refs[k];
      if (r !== undefined) out[k] = r.lapTimeS;
    }
    const sessionRef = refs.sessionBestClean ?? refs.sessionBest;
    return {
      refs: out,
      autoKind: autoReferenceKind({
        sessionType: input.sessionType,
        sessionTypeName: input.sessionTypeName,
        lapNumber,
        available: refs,
      }),
      allTimeS: this.allTime?.lapTimeS ?? null,
      sessionS: sessionRef?.lapTimeS ?? null,
    };
  }

  // --- resolving a completed lap (step 5) ---

  private resolvePending(input: DeltaTickInput, force = false): void {
    const p = this.pending;
    if (p === null) return;
    const arrived = p.timeFirst || input.lastLapS !== p.lastLapSBefore;
    if (!force && !arrived && input.tickS < p.crossedAtS + LAP_TIME_WAIT_S) return;
    this.pending = null;
    const lapTimeS = force && !arrived ? null : input.lastLapS;
    const time = lapTimeS !== null && lapTimeS > 0 ? lapTimeS : null;
    const clean = p.clean && !p.touchedPitRoad && time !== null;
    this.sectorTimer.resolve(p.sectors, clean);
    this.completion = {
      lapNumber: p.lapNumber,
      lapTimeS: time,
      clean,
      references: p.snapshot.refs,
      autoKind: p.snapshot.autoKind,
      completedAtS: input.tickS,
    };
    this.closingLap = false;

    const deltas: LastDeltas = {
      allTimeDeltaS: null,
      sessionDeltaS: null,
      allTimeSet: false,
      sessionSet: false,
    };
    if (time !== null) {
      if (p.snapshot.allTimeS !== null) deltas.allTimeDeltaS = time - p.snapshot.allTimeS;
      if (p.snapshot.sessionS !== null) deltas.sessionDeltaS = time - p.snapshot.sessionS;
      this.addSessionLap(p, time, clean, deltas, input.record);
    }
    this.lastDeltas = deltas;
  }

  private addSessionLap(
    p: Pending,
    time: number,
    clean: boolean,
    deltas: LastDeltas,
    record: boolean,
  ): void {
    const lap: TimedLap = { lapTimeS: time, trace: p.trace };
    const before = (this.sessionBestCleanLap ?? this.sessionBestLap)?.lapTimeS ?? null;
    this.last = lap;
    if (faster(time, this.sessionBestLap?.lapTimeS ?? null)) this.sessionBestLap = lap;
    if (clean && faster(time, this.sessionBestCleanLap?.lapTimeS ?? null)) {
      this.sessionBestCleanLap = lap;
    }
    const after = (this.sessionBestCleanLap ?? this.sessionBestLap)?.lapTimeS ?? null;
    deltas.sessionSet = after !== null && Math.abs(after - time) <= TIE_S && faster(time, before);

    if (clean && p.trace !== null) {
      this.optimal.addLap(p.trace, time);
      const current = this.allTime;
      const tieReplacesTimeOnly =
        current !== null && current.trace === null && Math.abs(time - current.lapTimeS) <= TIE_S;
      if (faster(time, current?.lapTimeS ?? null) || tieReplacesTimeOnly) {
        this.allTime = { lapTimeS: time, trace: p.trace };
        deltas.allTimeSet = !tieReplacesTimeOnly || current === null;
        this.recordBest(record, this.allTime);
      }
    }
  }

  // --- outputs (steps 6 to 10) ---

  private references(
    input: DeltaTickInput,
  ): Partial<Record<DeltaReferenceKind, DeltaReferenceLap>> {
    const out: Partial<Record<DeltaReferenceKind, DeltaReferenceLap>> = {};
    if (this.allTime !== null) {
      out.allTimeBest = ref("allTimeBest", this.allTime.lapTimeS, this.allTime.trace);
    }
    const clean = this.sessionBestCleanLap;
    if (clean !== null) out.sessionBestClean = ref("sessionBestClean", clean.lapTimeS, clean.trace);
    const best = this.sessionBestLap;
    if (best !== null) out.sessionBest = ref("sessionBest", best.lapTimeS, best.trace);
    else if (input.simBestLapS !== null && input.simBestLapS > 0) {
      out.sessionBest = ref("sessionBest", input.simBestLapS, null);
    }
    if (this.last !== null) out.lastLap = ref("lastLap", this.last.lapTimeS, this.last.trace);
    return out;
  }

  private liveDeltas(
    input: DeltaTickInput,
    refs: Partial<Record<DeltaReferenceKind, DeltaReferenceLap>>,
    elapsedS: number,
  ): Partial<Record<DeltaReferenceKind, LiveDelta>> {
    const out: Partial<Record<DeltaReferenceKind, LiveDelta>> = {};
    const pct = input.lapDistPct;
    for (const kind of KINDS) {
      const r = refs[kind];
      if (r === undefined) continue;
      const trace = this.traceOf(kind);
      const speedDeltaMps =
        trace !== null && pct !== null && input.speedMps !== null
          ? input.speedMps - traceSpeedAt(trace, pct)
          : null;
      const channel = this.channelFor(input, kind, refs);
      let live: LiveDelta;
      if (channel !== undefined) {
        this.rateOf(kind).reset();
        live = channel.ok
          ? {
              deltaS: channel.s,
              rate: channel.rate === null ? null : clamp1(channel.rate),
              speedDeltaMps,
              source: "sim",
            }
          : { deltaS: null, rate: null, speedDeltaMps, source: null };
      } else if (trace !== null && pct !== null && !this.lapBroken()) {
        const deltaS = computedDelta(trace, r.lapTimeS, pct, elapsedS);
        live = {
          deltaS,
          rate: this.rateOf(kind).next(input.tickS, deltaS),
          speedDeltaMps,
          source: "computed",
        };
      } else {
        this.rateOf(kind).reset();
        live = { deltaS: null, rate: null, speedDeltaMps, source: null };
      }
      out[kind] = live;
    }
    return out;
  }

  /** The sim channel for a kind, or undefined when the delta is to be computed. */
  private channelFor(
    input: DeltaTickInput,
    kind: DeltaReferenceKind,
    refs: Partial<Record<DeltaReferenceKind, DeltaReferenceLap>>,
  ) {
    const channels = input.channels;
    if (channels === null) return undefined;
    switch (kind) {
      case "allTimeBest":
        return channels.best ?? undefined;
      case "sessionBest":
        return channels.sessionBest ?? undefined;
      case "lastLap":
        return channels.sessionLast ?? undefined;
      case "sessionBestClean": {
        const clean = refs.sessionBestClean;
        const best = refs.sessionBest;
        if (clean === undefined || best === undefined) return undefined;
        return Math.abs(clean.lapTimeS - best.lapTimeS) <= TIE_S
          ? (channels.sessionBest ?? undefined)
          : undefined;
      }
    }
  }

  private traceOf = (kind: DeltaReferenceKind): LapTrace | null => {
    switch (kind) {
      case "allTimeBest":
        return this.allTime?.trace ?? null;
      case "sessionBestClean":
        return this.sessionBestCleanLap?.trace ?? null;
      case "sessionBest":
        return this.sessionBestLap?.trace ?? null;
      case "lastLap":
        return this.last?.trace ?? null;
    }
  };

  /** The reference laps that have a trace, for the sector deltas. */
  private sectorReferences(): SectorReference[] {
    const out: SectorReference[] = [];
    const add = (
      kind: DeltaReferenceKind,
      lap: { lapTimeS: number; trace: LapTrace | null } | null,
    ) => {
      if (lap !== null && lap.trace !== null)
        out.push({ kind, trace: lap.trace, lapTimeS: lap.lapTimeS });
    };
    add("allTimeBest", this.allTime);
    add("sessionBestClean", this.sessionBestCleanLap);
    add("sessionBest", this.sessionBestLap);
    add("lastLap", this.last);
    return out;
  }

  private lapBroken(): boolean {
    return this.forceBroken || this.recorder.broken;
  }

  private rateOf(kind: DeltaReferenceKind): DeltaRate {
    let r = this.rates.get(kind);
    if (r === undefined) {
      r = new DeltaRate();
      this.rates.set(kind, r);
    }
    return r;
  }

  private lapCompleteVisible(
    lapNumber: number | null,
    elapsedS: number,
    input: DeltaTickInput,
  ): boolean {
    const c = this.completion;
    if (c === null || c.lapTimeS === null || lapNumber === null) return false;
    if (c.lapNumber !== lapNumber - 1 || lapNumber <= 1) return false;
    if (input.sessionType === "race" && lapNumber <= 2) return false;
    return elapsedS <= LAP_COMPLETE_SHOW_S;
  }
}

function ref(
  kind: DeltaReferenceKind,
  lapTimeS: number,
  trace: LapTrace | null,
): DeltaReferenceLap {
  return { kind, lapTimeS, hasTrace: trace !== null };
}
