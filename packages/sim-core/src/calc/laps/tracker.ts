import type { SimState, TrackSurface } from "../../model";
import { LapCleanliness, type CleanSample } from "../delta/clean";
import { LAP_TIME_WAIT_S } from "../delta/tracker";
import type { FuelLapRecord } from "../fuel/types";
import type { Standings } from "../standings/types";
import { LAP_HISTORY_MAX, type LapHistory, type LapRecord } from "./types";

/** A lap time that changed this recently before the line was seen belongs to the lap just ended, seconds. */
const TIME_FIRST_S = 0.5;
/** Times closer than this are equal, seconds. */
const TIE_S = 0.0005;

/** One tick of the tracked car. */
export interface LapHistoryInput {
  tickS: number;
  carIdx: number;
  lapsCompleted: number | null;
  /** The sim's last lap time of the car, seconds. */
  lastLapS: number | null;
  onPitRoad: boolean;
  inPitStall: boolean;
  trackSurface: TrackSurface | null;
  /** The player's incident count; null for other cars. */
  incidentCount: number | null;
  trackTempC: number | null;
  /** The car's latest official sector times (StandingsEntry.sectorTimes). */
  sectorTimes: readonly (number | null)[] | null;
  /** The fuel calculator's lap records when the car is the player's; null otherwise. */
  fuelLaps: readonly FuelLapRecord[] | null;
}

/**
 * The tick input for the focus car (player, else the camera car); null when there is none or
 * the clock is unknown. `fuelLaps` are the player's fuel lap records.
 */
export function lapHistoryInput(
  state: SimState,
  standings: Standings | null,
  fuelLaps: readonly FuelLapRecord[] | null,
): LapHistoryInput | null {
  const carIdx = state.playerCarIdx ?? state.focusCarIdx;
  if (carIdx === null || state.tickTimeS === null) return null;
  const car = state.cars.find((c) => c.carIdx === carIdx);
  if (car === undefined || car.isPaceCar === true) return null;
  const isPlayer = carIdx === state.playerCarIdx;
  const entry = standings?.entries.find((e) => e.carIdx === carIdx);
  return {
    tickS: state.tickTimeS,
    carIdx,
    lapsCompleted: car.lapsCompleted,
    // The player's own lap time channel is the precise one where both exist.
    lastLapS: (isPlayer ? state.player.lap?.lastLapS : undefined) ?? car.lastLapS,
    onPitRoad: car.onPitRoad === true,
    inPitStall: car.inPitStall === true,
    trackSurface: (isPlayer ? state.player.trackSurface : null) ?? car.trackSurface,
    incidentCount: isPlayer ? state.player.incidentCount : null,
    trackTempC: state.conditions.trackTempC,
    sectorTimes: entry?.sectorTimes ?? null,
    fuelLaps: isPlayer ? fuelLaps : null,
  };
}

interface StoredLap {
  out: LapRecord;
  /** The fuel record was found (or the car is not the player's). */
  fuelDone: boolean;
}

interface Pending {
  lap: StoredLap;
  clean: boolean;
  atLine: boolean;
  crossedAtS: number;
  lastLapSBefore: number | null;
  timeFirst: boolean;
}

/**
 * Follows the focus car lap by lap: the sim's lap time (which can arrive a little after the
 * line), whether the lap was clean, the track temperature at the line, the fuel used and the
 * official sector times. A different focus car starts a new history. Stateful, free of timers.
 */
export class LapHistoryTracker {
  private carIdx: number | null = null;
  private laps: StoredLap[] = [];
  private pending: Pending | null = null;
  private bestLapS: number | null = null;
  private bestLapNumber: number | null = null;
  private sectorBests: (number | null)[] = [];

  // The lap in progress.
  private started = false;
  private atLine = false;
  private cleanliness = new LapCleanliness();
  private sectors: (number | null)[] = [];

  /** A tick of this car was seen before, so the prev* fields hold its values. */
  private seen = false;
  private prevLapsCompleted: number | null = null;
  private prevLastLapS: number | null = null;
  private lastLapChangedAtS: number | null = null;
  private prevSectors: readonly (number | null)[] | null = null;

  private output: LapHistory | null = null;
  private dirty = true;

  reset(): void {
    this.carIdx = null;
    this.forget();
  }

  next(input: LapHistoryInput | null): LapHistory | null {
    if (input === null) return this.carIdx === null ? null : this.publish();
    if (input.carIdx !== this.carIdx) {
      this.forget();
      this.carIdx = input.carIdx;
    }
    this.trackSectors(input);
    this.advance(input);
    if (this.pending !== null) this.resolvePending(input);
    this.attachFuel(input.fuelLaps);
    if (this.seen && input.lastLapS !== this.prevLastLapS) this.lastLapChangedAtS = input.tickS;
    this.seen = true;
    this.prevLastLapS = input.lastLapS;
    this.prevLapsCompleted = input.lapsCompleted;
    return this.publish();
  }

  private forget(): void {
    this.laps = [];
    this.pending = null;
    this.bestLapS = null;
    this.bestLapNumber = null;
    this.sectorBests = [];
    this.started = false;
    this.atLine = false;
    this.sectors = [];
    this.seen = false;
    this.prevLapsCompleted = null;
    this.prevLastLapS = null;
    this.lastLapChangedAtS = null;
    this.prevSectors = null;
    this.output = null;
    this.dirty = true;
  }

  private publish(): LapHistory | null {
    if (this.carIdx === null) return null;
    if (this.dirty || this.output === null) {
      this.output = {
        carIdx: this.carIdx,
        laps: this.laps.map((l) => l.out),
        bestLapS: this.bestLapS,
        bestLapNumber: this.bestLapNumber,
        optimalLapS: this.optimal(),
      };
      this.dirty = false;
    }
    return this.output;
  }

  private optimal(): number | null {
    const bests = this.sectorBests;
    if (bests.length === 0 || bests.some((b) => b === null)) return null;
    return bests.reduce<number>((sum, b) => sum + (b ?? 0), 0);
  }

  // --- the lap in progress ---

  private cleanSample(input: LapHistoryInput): CleanSample {
    return {
      incidentCount: input.incidentCount,
      trackSurface: input.trackSurface,
      onPitRoad: input.onPitRoad,
      inPitStall: input.inPitStall,
    };
  }

  private startLap(input: LapHistoryInput, atLine: boolean): void {
    this.started = true;
    this.atLine = atLine;
    this.cleanliness.start(this.cleanSample(input));
    this.sectors = this.sectors.map(() => null);
  }

  private advance(input: LapHistoryInput): void {
    const done = input.lapsCompleted;
    const prev = this.prevLapsCompleted;
    if (!this.started) {
      // A lap joined at the start of the session (no lap completed yet) is watched from the line.
      this.startLap(input, done === 0);
      return;
    }
    if (done !== prev && done !== null) {
      if (prev !== null && done === prev + 1) {
        this.crossLine(input, done);
        return;
      }
      if (prev !== null && done < prev) {
        // The lap count went back (a restarted replay): the laps no longer follow on.
        const carIdx = this.carIdx;
        this.forget();
        this.carIdx = carIdx;
        this.startLap(input, done === 0);
        return;
      }
      // A jump or the first count: the lap in progress was not watched from the line.
      if (this.pending !== null) this.resolvePending(input, true);
      this.startLap(input, prev === null && done === 0);
      return;
    }
    this.cleanliness.sample(this.cleanSample(input));
  }

  private crossLine(input: LapHistoryInput, lapNumber: number): void {
    if (this.pending !== null) this.resolvePending(input, true);
    const lap: StoredLap = {
      out: {
        lapNumber,
        lapTimeS: null,
        valid: false,
        pit: this.cleanliness.touchedPitRoad,
        trackTempC: input.trackTempC,
        fuelUsedL: null,
        sectorTimes: this.prevSectors === null ? null : [...this.sectors],
      },
      fuelDone: false,
    };
    this.pending = {
      lap,
      clean: this.cleanliness.clean,
      atLine: this.atLine,
      crossedAtS: input.tickS,
      lastLapSBefore: this.prevLastLapS,
      timeFirst:
        this.lastLapChangedAtS !== null && input.tickS - this.lastLapChangedAtS <= TIME_FIRST_S,
    };
    this.startLap(input, true);
  }

  /** The lap time arrived (or the wait ran out, or `force`): the lap joins the history. */
  private resolvePending(input: LapHistoryInput, force = false): void {
    const p = this.pending;
    if (p === null) return;
    const arrived = p.timeFirst || input.lastLapS !== p.lastLapSBefore;
    if (!force && !arrived && input.tickS < p.crossedAtS + LAP_TIME_WAIT_S) return;
    this.pending = null;
    const raw = arrived ? input.lastLapS : null;
    const time = raw !== null && Number.isFinite(raw) && raw > 0 ? raw : null;
    const valid = p.clean && p.atLine && time !== null;
    const lap = p.lap;
    lap.out = { ...lap.out, lapTimeS: time, valid };
    this.laps.unshift(lap);
    if (this.laps.length > LAP_HISTORY_MAX) this.laps.length = LAP_HISTORY_MAX;
    if (valid && time !== null && (this.bestLapS === null || time < this.bestLapS - TIE_S)) {
      this.bestLapS = time;
      this.bestLapNumber = lap.out.lapNumber;
    }
    if (valid) this.addSectorBests(lap.out.sectorTimes);
    this.dirty = true;
  }

  private addSectorBests(times: readonly (number | null)[] | null): void {
    if (times === null || times.length !== this.sectorBests.length) return;
    times.forEach((t, i) => {
      const b = this.sectorBests[i] ?? null;
      if (t !== null && (b === null || t < b)) this.sectorBests[i] = t;
    });
  }

  // --- sectors ---

  /**
   * Every sector time that changed since the last tick was just completed. The last sector seen
   * before the first sector of the new lap belongs to the lap that ended at the line.
   */
  private trackSectors(input: LapHistoryInput): void {
    const now = input.sectorTimes;
    const prev = this.prevSectors;
    this.prevSectors = now;
    if (now === null) {
      if (prev !== null) this.resetSectors(0);
      return;
    }
    if (prev === null || prev.length !== now.length) {
      this.resetSectors(now.length);
      return;
    }
    if (prev === now) return;
    const n = now.length;
    for (let i = 0; i < n; i++) {
      const v = now[i] ?? null;
      if (v === null || v === (prev[i] ?? null)) continue;
      const newLapEmpty = this.sectors.slice(0, n - 1).every((s) => s === null);
      if (n > 1 && i === n - 1 && newLapEmpty && this.lateLastSector(v)) continue;
      this.sectors[i] = v;
    }
  }

  /** Gives the previous lap its last sector when it has none yet; false when there is no such lap. */
  private lateLastSector(time: number): boolean {
    const target = this.pending?.lap ?? this.laps[0];
    const times = target?.out.sectorTimes;
    if (target === undefined || times === null || times === undefined) return false;
    const last = times.length - 1;
    if (times[last] !== null) return false;
    const next = [...times];
    next[last] = time;
    target.out = { ...target.out, sectorTimes: next };
    if (this.pending?.lap !== target) {
      if (target.out.valid) this.addSectorBests(next);
      this.dirty = true;
    }
    return true;
  }

  /** New sector layout: no sector data in hand for any lap. */
  private resetSectors(n: number): void {
    this.sectors = new Array<number | null>(n).fill(null);
    this.sectorBests = new Array<number | null>(n).fill(null);
    this.dirty = true;
  }

  // --- fuel ---

  private attachFuel(records: readonly FuelLapRecord[] | null): void {
    for (const lap of this.laps) {
      if (lap.fuelDone) continue;
      if (records === null) {
        lap.fuelDone = true;
        continue;
      }
      const rec = findRecord(records, lap.out.lapNumber);
      if (rec === undefined) continue;
      lap.fuelDone = true;
      if (rec.valid && Number.isFinite(rec.usedL) && rec.usedL > 0) {
        lap.out = { ...lap.out, fuelUsedL: rec.usedL };
        this.dirty = true;
      }
    }
  }
}

/** The newest fuel record of that lap (records are appended in lap order). */
function findRecord(
  records: readonly FuelLapRecord[],
  lapNumber: number,
): FuelLapRecord | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i]!;
    if (rec.lapNumber === lapNumber) return rec;
    if (rec.lapNumber < lapNumber) return undefined;
  }
  return undefined;
}
