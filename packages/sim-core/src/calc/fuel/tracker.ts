import {
  computeFuelDelta,
  computeFuelPitWindow,
  computePlusOneLapTarget,
  estimateFuelTankCapacity,
  fuelLapsRemaining,
} from "./formulas";
import type {
  FuelContext,
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

interface CurrentLap {
  startFuelL: number;
  startedOnPitRoad: boolean;
  startState: number;
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
  private sawRefuel = false;
  private tankEstimateL: number | null = null;

  constructor(options: FuelTrackerOptions = {}) {
    this.minUse = options.minLapUse ?? 0.5;
    this.maxUse = options.maxLapUse ?? 50;
    this.refuelJump = options.refuelJump ?? 1;
    this.pitRefuelJump = options.pitRefuelJump ?? 0.2;
    this.maxWindow = options.maxLapWindow ?? 5;
  }

  get lapRecords(): readonly FuelLapRecord[] {
    return this.laps;
  }

  update(s: FuelSample): void {
    const prev = this.prev;
    this.prev = s;
    if (prev === null) {
      const midLap = s.lapDistPct > MID_LAP_START_MIN && s.lapDistPct < MID_LAP_START_MAX;
      this.beginLap(s, midLap ? "unknownStart" : null);
      return;
    }
    if (s.sessionNum !== prev.sessionNum) {
      this.resetSession();
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
      this.laps.push({
        lapNumber: s.lap,
        startState: cur.startState,
        endState: s.sessionState,
        usedL: cur.startFuelL - s.fuelL,
        valid: false,
        reason,
      });
    }
    this.expectWrap = false;
    this.expectCounter = false;
    const midLap = s.lapDistPct > MID_LAP_START_MIN && s.lapDistPct < MID_LAP_START_MAX;
    this.beginLap(s, nextLapReason ?? (midLap ? "unknownStart" : null));
  }

  private finishLap(s: FuelSample): void {
    const cur = this.current;
    if (cur !== null) {
      const usedL = cur.startFuelL - s.fuelL;
      const reason = this.classify(cur, usedL);
      this.laps.push({
        lapNumber: s.lap,
        startState: cur.startState,
        endState: s.sessionState,
        usedL,
        valid: reason === null,
        reason,
      });
    }
    this.beginLap(s, null);
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
      refuelled: false,
      paceLap: s.isPaceLap,
      forcedReason: forced,
    };
  }

  private resetSession(): void {
    this.laps = [];
    this.current = null;
    this.expectWrap = false;
    this.expectCounter = false;
    this.sawRefuel = false;
    this.tankEstimateL = null;
  }

  snapshot(ctx: FuelContext): FuelOutputs {
    const valid = this.laps.filter((l) => l.valid);
    const last = this.prev;
    if (valid.length === 0 || last === null) {
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
      };
    }

    const ownAvg = valid.reduce((a, l) => a + l.usedL, 0) / valid.length;
    const avg = ctx.fuelAvgOverride ?? ownAvg;
    const max = Math.max(...valid.slice(-this.maxWindow).map((l) => l.usedL));
    const currentFuel = last.fuelL;
    const completed = last.lap;

    // The reference estimate holds only until the first refuel, then the last value is kept.
    if (ctx.tankCapacityL == null && !this.sawRefuel) {
      this.tankEstimateL = estimateFuelTankCapacity(currentFuel, completed, ownAvg);
    }
    const tank = ctx.tankCapacityL ?? this.tankEstimateL;

    const remAvg = fuelLapsRemaining(currentFuel, avg);
    const target = remAvg === null ? null : computePlusOneLapTarget(currentFuel, remAvg);
    const lapsToGo = ctx.lapsToGo;
    const needsTwo = valid.length >= 2 && lapsToGo != null;

    return {
      fuelLastLap: valid[valid.length - 1]!.usedL,
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
    };
  }
}
