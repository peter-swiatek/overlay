import {
  computeFuelDelta,
  computeFuelPitWindow,
  computePlusOneLapTarget,
  estimateFuelTankCapacity,
  fuelLapsRemaining,
} from "./formulas";
import type { SeedLap } from "./history";
import type {
  FuelContext,
  FuelLapUse,
  FuelInvalidReason,
  FuelLapRecord,
  FuelOutputs,
  FuelSample,
  FuelTrackerOptions,
} from "./types";

/** First sample inside this pct band means we joined mid-lap and the first usage is partial. */
const MID_LAP_START_MIN = 0.05;
const MID_LAP_START_MAX = 0.95;
/** Pct falling by more than this in one tick is an S/F wrap (not a tow or reset to a nearby spot). */
const WRAP_DROP = 0.5;
/** A wrap only counts as an S/F crossing when it runs from beyond HIGH to below LOW. */
const WRAP_HIGH = 0.9;
const WRAP_LOW = 0.1;
/** Moving forward more than this in one tick is a tow or a gap in the samples, not driving. */
const FORWARD_JUMP = 0.15;
/** iRacing SessionState: 3 parade laps, 5 checkered, 6 cooldown. */
const PARADE_STATE = 3;
const COOLDOWN_STATE = 5;

/** The seed is dropped when the first own valid lap differs from its average by more than this share. */
const SEED_MISMATCH = 0.2;

/** At most this many seed laps are used. */
const SEED_LAPS = 10;

interface CurrentLap {
  startFuelL: number;
  startedOnPitRoad: boolean;
  startState: number;
  /** Session time at the start crossing; null when the sample carried none. */
  startTimeS: number | null;
  /** Lowest fuel seen this lap; refuel is judged by the cumulative rise above it. */
  minFuelL: number;
  refuelled: boolean;
  paceLap: boolean;
  /** Set by a session change or a lap counter reset; forces the lap invalid. */
  forcedReason: FuelInvalidReason | null;
}

/**
 * Per-lap fuel bookkeeping. Pure: feed samples in time order with `update`, read results with
 * `snapshot`. The unit is whatever `fuelL` carries (litres, or energy fraction with other options).
 */
export class FuelTracker {
  private readonly minUse: number;
  private readonly maxUse: number;
  private readonly refuelJump: number;
  private readonly pitRefuelJump: number;
  private readonly maxWindow: number;

  private laps: FuelLapRecord[] = [];
  private current: CurrentLap | null = null;
  private prev: FuelSample | null = null;
  /** The counter ticked before pct wrapped, so the coming wrap must not count again. */
  private expectWrap = false;
  /** Pct wrapped before the counter ticked, so the coming increment must not count again. */
  private expectCounter = false;
  /** The lap record closed by a pct wrap, still waiting for the counter value after it ticks. */
  private pendingLap: FuelLapRecord | null = null;
  private sawRefuel = false;
  private tankEstimateL: number | null = null;
  /** Lap times live beside the records because FuelLapRecord is a frozen contract type. */
  private readonly lapTimes = new WeakMap<FuelLapRecord, number | null>();
  /** Completed-lap counter and session time when the current stint began. */
  private stintStartLap = 0;
  private stintStartTimeS: number | null = null;
  /** Use per lap from earlier sessions (oldest first), already within this tracker's limits. */
  private seedUse: number[] = [];

  constructor(options: FuelTrackerOptions = {}) {
    this.minUse = options.minLapUse ?? 0.5;
    this.maxUse = options.maxLapUse ?? 50;
    this.refuelJump = options.refuelJump ?? 1;
    this.pitRefuelJump = options.pitRefuelJump ?? 0.2;
    this.maxWindow = options.maxLapWindow ?? 5;
  }

  /**
   * Laps from earlier sessions (oldest first). They stand in for valid laps until this session has
   * 2 valid laps of its own; `[]` clears. Laps outside the validity limits are ignored.
   */
  seed(laps: readonly SeedLap[]): void {
    this.seedUse = laps
      .filter((l) => Number.isFinite(l.used) && l.used >= this.minUse && l.used <= this.maxUse)
      .map((l) => l.used)
      .slice(-SEED_LAPS);
  }

  private seedUsable(own: readonly number[]): boolean {
    if (this.seedUse.length === 0 || own.length === 0) return true;
    const mean = this.seedUse.reduce((a, u) => a + u, 0) / this.seedUse.length;
    return Math.abs(own[0]! - mean) <= SEED_MISMATCH * mean;
  }

  get lapRecords(): readonly FuelLapRecord[] {
    return this.laps;
  }

  update(s: FuelSample): void {
    const prev = this.prev;
    this.prev = s;
    if (prev === null) {
      this.startStint(s);
      const midLap = s.lapDistPct > MID_LAP_START_MIN && s.lapDistPct < MID_LAP_START_MAX;
      this.beginLap(s, midLap ? "unknownStart" : null);
      return;
    }
    if (s.sessionNum !== prev.sessionNum) {
      this.resetSession();
      this.startStint(s);
      this.beginLap(s, "sessionChange");
      return;
    }
    if (s.lap < prev.lap) {
      if (s.sessionState >= COOLDOWN_STATE) {
        // After the flag the sim resets the car to the pits (the counter drops, as seen in real
        // recordings); keep the finished race's figures.
        this.voidLap(s, "reset");
        return;
      }
      // Counter went backwards mid-session: treated like a session change.
      this.resetSession();
      this.startStint(s);
      this.beginLap(s, "sessionChange");
      return;
    }

    this.observe(s);

    if (s.lap - prev.lap >= 2) {
      // Samples were missed: two or more laps merged would poison the average.
      this.voidLap(s, "skipped");
      return;
    }

    const counterTicked = s.lap > prev.lap;
    const dropped = prev.lapDistPct - s.lapDistPct > WRAP_DROP;
    const wrapped =
      dropped && prev.lapDistPct > WRAP_HIGH && s.lapDistPct < WRAP_LOW && !s.inPitStall;
    if (dropped && !wrapped && !counterTicked) {
      // Position jumped back without crossing the line: tow or reset to the pits.
      this.voidLap(s, "reset");
      return;
    }
    if (!dropped && !counterTicked && s.lapDistPct - prev.lapDistPct > FORWARD_JUMP) {
      this.voidLap(s, "reset");
      return;
    }
    if (
      counterTicked &&
      !this.expectCounter &&
      s.lapDistPct > WRAP_LOW &&
      s.lapDistPct < WRAP_HIGH
    ) {
      // The counter ticked far from the line: we missed samples around the crossing.
      this.voidLap(s, "skipped", "unknownStart");
      return;
    }
    let crossed = false;
    if (counterTicked) {
      if (this.expectCounter) {
        this.expectCounter = false;
        // The wrap closed this lap with the old counter; the lap number is the value after the tick.
        if (this.pendingLap !== null) this.pendingLap.lapNumber = s.lap;
      } else {
        crossed = true;
        // Counter first: the pct wrap is still to come while we are before the line.
        this.expectWrap = s.lapDistPct > 0.5;
      }
      if (wrapped) this.expectWrap = false;
    } else if (wrapped) {
      if (this.expectWrap) {
        this.expectWrap = false;
      } else {
        crossed = true;
        this.expectCounter = true;
      }
    }
    if (crossed) this.finishLap(s);
  }

  private observe(s: FuelSample): void {
    const cur = this.current;
    if (cur === null) return;
    const rise = s.fuelL - cur.minFuelL;
    cur.minFuelL = Math.min(cur.minFuelL, s.fuelL);
    const inPits = s.inPitStall || s.onPitRoad;
    if (rise > this.refuelJump || (inPits && rise > this.pitRefuelJump)) {
      if (!cur.refuelled) this.startStint(s);
      cur.refuelled = true;
      this.sawRefuel = true;
    }
    if (s.isPaceLap) cur.paceLap = true;
  }

  /** Records the lap in progress as invalid and starts a fresh lap at `s`. */
  private voidLap(
    s: FuelSample,
    reason: FuelInvalidReason,
    nextLapReason: FuelInvalidReason | null = null,
  ): void {
    const cur = this.current;
    if (cur !== null) {
      this.pushLap(cur, s, cur.startFuelL - s.fuelL, reason);
    }
    this.expectWrap = false;
    this.expectCounter = false;
    this.pendingLap = null;
    const midLap = s.lapDistPct > MID_LAP_START_MIN && s.lapDistPct < MID_LAP_START_MAX;
    this.beginLap(s, nextLapReason ?? (midLap ? "unknownStart" : null));
  }

  private finishLap(s: FuelSample): void {
    const cur = this.current;
    this.pendingLap = null;
    if (cur !== null) {
      const usedL = cur.startFuelL - s.fuelL;
      const reason = this.classify(cur, usedL);
      this.pushLap(cur, s, usedL, reason);
      // After a pct wrap the counter has not ticked yet: the lap is the next counter value, and
      // is corrected when the tick arrives.
      if (this.expectCounter) {
        const rec = this.laps[this.laps.length - 1] as FuelLapRecord;
        rec.lapNumber = s.lap + 1;
        this.pendingLap = rec;
      }
    }
    this.beginLap(s, null);
  }

  private pushLap(
    cur: CurrentLap,
    s: FuelSample,
    usedL: number,
    reason: FuelInvalidReason | null,
  ): void {
    const record: FuelLapRecord = {
      lapNumber: s.lap,
      startState: cur.startState,
      endState: s.sessionState,
      usedL,
      valid: reason === null,
      reason,
    };
    this.laps.push(record);
    const t = cur.startTimeS === null ? null : cleanTime(s.sessionTimeS - cur.startTimeS);
    this.lapTimes.set(record, t);
  }

  /** A stint begins at the first sample of a session and at every detected refuel. */
  private startStint(s: FuelSample): void {
    // iRacing counts -1 completed laps on the grid and 0 after the first crossing, so a 12-lap race
    // would read 13. A grid start (negative counter, not on pit road) counts from 0, the same
    // definition as the standings' stint laps.
    this.stintStartLap = s.lap < 0 && !s.onPitRoad ? 0 : s.lap;
    this.stintStartTimeS = Number.isFinite(s.sessionTimeS) ? s.sessionTimeS : null;
  }

  private classify(cur: CurrentLap, usedL: number): FuelInvalidReason | null {
    if (cur.startState >= COOLDOWN_STATE) return "cooldown";
    if (cur.startState === PARADE_STATE || cur.paceLap) return "paceLap";
    if (cur.forcedReason !== null) return cur.forcedReason;
    if (cur.startedOnPitRoad) return "outlap";
    if (cur.refuelled) return "refuel";
    if (usedL > this.maxUse) return "dataError";
    if (usedL < this.minUse) return "partial";
    return null;
  }

  private beginLap(s: FuelSample, forced: FuelInvalidReason | null): void {
    this.current = {
      startFuelL: s.fuelL,
      minFuelL: s.fuelL,
      startedOnPitRoad: s.onPitRoad,
      startState: s.sessionState,
      startTimeS: Number.isFinite(s.sessionTimeS) ? s.sessionTimeS : null,
      refuelled: false,
      paceLap: s.isPaceLap,
      forcedReason: forced,
    };
  }

  /** Counts session resets (the lap records restart each time), so callers can tell a new record list from the old one. */
  get resetCount(): number {
    return this.resets;
  }

  private resets = 0;

  private resetSession(): void {
    this.resets++;
    this.laps = [];
    this.current = null;
    this.expectWrap = false;
    this.expectCounter = false;
    this.pendingLap = null;
    this.sawRefuel = false;
    this.tankEstimateL = null;
  }

  /** The figures that exist from the first sample on, before any valid lap. */
  private stintFields(): Pick<FuelOutputs, "stintLaps" | "stintTimeS"> {
    const last = this.prev;
    if (last === null) return { stintLaps: 0, stintTimeS: null };
    return {
      stintLaps: Math.max(0, last.lap - this.stintStartLap),
      stintTimeS:
        this.stintStartTimeS === null || !Number.isFinite(last.sessionTimeS)
          ? null
          : Math.max(0, last.sessionTimeS - this.stintStartTimeS),
    };
  }

  private lapFields(
    valid: readonly FuelLapRecord[],
    ctx: FuelContext,
    basis: readonly number[],
  ): LapFields {
    const recent: FuelLapUse[] = valid
      .slice(-10)
      .reverse()
      .map((l) => ({
        lapNumber: l.lapNumber,
        used: l.usedL,
        lapTimeS: this.lapTimes.get(l) ?? null,
      }));
    // The reference defines no 5- or 10-lap average; plain means over the newest valid laps, fewer when
    // the session has fewer.
    // `basis` is the own valid laps, or the seed followed by them while the seed is in use.
    const mean = (n: number): number | null => {
      const use = basis.slice(-n).reverse();
      return use.length === 0 ? null : use.reduce((a, u) => a + u, 0) / use.length;
    };
    // The reference defines no per-hour figure: total use over total lap time, both over the valid laps
    // that have a lap time.
    let usedTimed = 0;
    let timeS = 0;
    for (const l of valid) {
      const t = this.lapTimes.get(l) ?? null;
      if (t === null) continue;
      usedTimed += l.usedL;
      timeS += t;
    }
    return {
      fuelAvg5Lap: mean(5),
      fuelAvg10Lap: mean(10),
      recentLaps: recent,
      lapsToGo: ctx.lapsToGo,
      fuelPerHour: timeS > 0 ? usedTimed / (timeS / 3600) : null,
    };
  }

  snapshot(ctx: FuelContext): FuelOutputs {
    const valid = this.laps.filter((l) => l.valid);
    const last = this.prev;
    // Seeded laps count until the session has 2 valid laps of its own, then they are ignored.
    const own = valid.map((l) => l.usedL);
    // A first own lap more than 20 % off the seed average means the seed is the wrong car or
    // setup (LMU keys by class only), so it is dropped at once.
    const seedBasis = this.seedUsable(own) ? this.seedUse : [];
    const basis = valid.length >= 2 ? own : [...seedBasis, ...own];
    if (basis.length === 0 || last === null) {
      return {
        fuelLastLap: null,
        fuelAvgLap: null,
        fuelMaxLap: null,
        lapsRemainingAvg: null,
        lapsRemainingConservative: null,
        fuelDelta: null,
        plusOneLapTarget: null,
        fuelSavingNeeded: null,
        pitWindow: null,
        tankCapacityL: ctx.tankCapacityL ?? this.tankEstimateL,
        validLapCount: valid.length,
        ...this.lapFields(valid, ctx, basis),
        ...this.stintFields(),
      };
    }

    const basisAvg = basis.reduce((a, u) => a + u, 0) / basis.length;
    const avg = ctx.fuelAvgOverride ?? basisAvg;
    const max = Math.max(...basis.slice(-this.maxWindow));
    const currentFuel = last.fuelL;
    const completed = last.lap;

    // The estimate holds only until the first refuel, then the last value is kept.
    // It needs this session's completed laps, so it uses the own average only (never the seed).
    if (ctx.tankCapacityL == null && !this.sawRefuel && own.length > 0) {
      const ownAvg = own.reduce((a, u) => a + u, 0) / own.length;
      this.tankEstimateL = estimateFuelTankCapacity(currentFuel, completed, ownAvg);
    }
    const tank = ctx.tankCapacityL ?? this.tankEstimateL;

    const remAvg = fuelLapsRemaining(currentFuel, avg);
    const target = remAvg === null ? null : computePlusOneLapTarget(currentFuel, remAvg);
    const lapsToGo = ctx.lapsToGo;
    const needsTwo = basis.length >= 2 && lapsToGo != null;

    return {
      fuelLastLap: own.length === 0 ? null : own[own.length - 1]!,
      fuelAvgLap: avg,
      fuelMaxLap: max,
      lapsRemainingAvg: remAvg,
      lapsRemainingConservative: fuelLapsRemaining(currentFuel, max),
      fuelDelta: needsTwo ? computeFuelDelta(currentFuel, lapsToGo, avg) : null,
      plusOneLapTarget: target,
      fuelSavingNeeded: target === null ? null : avg - target,
      pitWindow:
        needsTwo && tank !== null
          ? computeFuelPitWindow({
              currentFuelL: currentFuel,
              currentLap: completed,
              totalLaps: completed + last.lapDistPct + lapsToGo,
              fuelAvgLap: avg,
              tankCapacityL: tank,
            })
          : null,
      tankCapacityL: tank,
      validLapCount: valid.length,
      ...this.lapFields(valid, ctx, basis),
      ...this.stintFields(),
    };
  }
}

type LapFields = Pick<
  FuelOutputs,
  "fuelAvg5Lap" | "fuelAvg10Lap" | "recentLaps" | "lapsToGo" | "fuelPerHour"
>;

function cleanTime(t: number): number | null {
  return Number.isFinite(t) && t > 0 ? t : null;
}
