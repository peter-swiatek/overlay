import type { Car, SimState, TyreSet } from "../model";

/** The player's car in a state, or null when it is not there (yet). */
export function playerCar(state: SimState): Car | null {
  if (state.playerCarIdx === null) return null;
  return state.cars.find((c) => c.carIdx === state.playerCarIdx) ?? null;
}

/**
 * The lap being driven, numbered like the fuel tracker's records: the completed-lap counter the
 * lap will have when it ends. Before the first S/F crossing (counter unknown) that is lap 0.
 */
export function lapInProgress(car: Car): number {
  return (car.lapsCompleted ?? -1) + 1;
}

function meanWear(tyres: TyreSet | null): number | null {
  if (tyres === null) return null;
  const wear = [tyres.fl.wear, tyres.fr.wear, tyres.rl.wear, tyres.rr.wear].filter(
    (w): w is number => w !== null,
  );
  return wear.length === 0 ? null : wear.reduce((a, b) => a + b, 0) / wear.length;
}

// ---- Laps -------------------------------------------------------------------------------------

/** Everything about one lap that the fuel tracker's record does not hold. */
export interface LapSummary {
  /** Fuel in the tank when the lap began and ended, litres. */
  fuelStartL: number | null;
  fuelEndL: number | null;
  /** LMU virtual energy used, as a fraction of a full tank (negative after a refill). */
  energyUsed: number | null;
  incidentsDelta: number | null;
  /** The lap touched pit road (an out lap, an in lap or a stop). */
  pitLap: boolean;
  /** Mean track temperature over the lap, degrees Celsius. */
  trackTempC: number | null;
  /** Mean tyre wear at the end minus at the start (0 new .. 1 worn). */
  tyreWearDelta: number | null;
  positionEnd: number | null;
  startedAtS: number | null;
  endedAtS: number | null;
  /** End minus start of session time when both ends were S/F crossings, else null. */
  crossingTimeS: number | null;
}

interface OpenLap {
  fuelStartL: number | null;
  energyStart: number | null;
  incidentsStart: number | null;
  wearStart: number | null;
  startedAtS: number | null;
  startedAtCrossing: boolean;
  pitLap: boolean;
  tempSum: number;
  tempCount: number;
  lastObservedS: number | null;
}

function openLap(state: SimState, crossing: boolean): OpenLap {
  const car = playerCar(state);
  return {
    fuelStartL: state.player.fuelL,
    energyStart: state.player.energyFraction,
    incidentsStart: state.player.incidentCount,
    wearStart: meanWear(state.player.tyres),
    startedAtS: state.tickTimeS,
    startedAtCrossing: crossing,
    pitLap: car?.onPitRoad === true,
    tempSum: 0,
    tempCount: 0,
    lastObservedS: null,
  };
}

/**
 * Per-tick bookkeeping for the lap in progress. Lap detection stays with the fuel tracker: the
 * caller feeds every tick to `observe`, and when the tracker adds a record on that tick calls
 * `close` to get the matching summary (which also starts the next lap on the same tick).
 */
export class LapAccumulator {
  private lap: OpenLap | null = null;

  /** Call once per tick, before `close`. */
  observe(state: SimState): void {
    const car = playerCar(state);
    if (car === null) return;
    this.lap ??= openLap(state, false);
    const lap = this.lap;
    if (car.onPitRoad === true) lap.pitLap = true;
    const temp = state.conditions.trackTempC;
    if (temp !== null) {
      lap.tempSum += temp;
      lap.tempCount++;
    }
  }

  /** The lap ended on this tick. `crossed` is false for laps the tracker cut short (resets). */
  close(state: SimState, crossed: boolean): LapSummary {
    const lap = this.lap ?? openLap(state, false);
    const car = playerCar(state);
    const energyEnd = state.player.energyFraction;
    const incidentsEnd = state.player.incidentCount;
    const wearEnd = meanWear(state.player.tyres);
    const endedAtS = state.tickTimeS;
    const summary: LapSummary = {
      fuelStartL: lap.fuelStartL,
      fuelEndL: state.player.fuelL,
      energyUsed:
        lap.energyStart !== null && energyEnd !== null ? lap.energyStart - energyEnd : null,
      incidentsDelta:
        lap.incidentsStart !== null && incidentsEnd !== null
          ? Math.max(0, incidentsEnd - lap.incidentsStart)
          : null,
      pitLap: lap.pitLap,
      trackTempC: lap.tempCount === 0 ? null : lap.tempSum / lap.tempCount,
      tyreWearDelta: lap.wearStart !== null && wearEnd !== null ? wearEnd - lap.wearStart : null,
      positionEnd: car?.position ?? null,
      startedAtS: lap.startedAtS,
      endedAtS,
      crossingTimeS:
        lap.startedAtCrossing && crossed && lap.startedAtS !== null && endedAtS !== null
          ? endedAtS - lap.startedAtS
          : null,
    };
    this.lap = openLap(state, crossed);
    return summary;
  }
}

/**
 * True when the sim's last-lap time has a new, usable value since `before`. iRacing and LMU
 * update it a moment after the line, which may be a tick later than the lap record.
 */
export function lastLapMoved(before: number | null, now: number | null): boolean {
  return now !== null && now > 0 && now !== before;
}

// ---- Incidents --------------------------------------------------------------------------------

export interface IncidentEvent {
  /** Lap in progress, numbered like {@link lapInProgress}. */
  lap: number;
  timeS: number | null;
  /** Points gained since the previous tick. */
  countDelta: number;
}

/** Turns the player's cumulative incident count into events. */
export class IncidentTracker {
  private previous: number | null = null;

  update(state: SimState): IncidentEvent | null {
    const count = state.player.incidentCount;
    const car = playerCar(state);
    if (count === null) return null;
    const before = this.previous;
    this.previous = count;
    // The first value is the count we joined with; a drop means the sim reset it.
    if (before === null || count <= before || car === null) return null;
    return { lap: lapInProgress(car), timeS: state.tickTimeS, countDelta: count - before };
  }
}

// ---- Pit stops and stints ---------------------------------------------------------------------

export interface PitStopEvent {
  /** Lap in progress at pit entry. */
  lap: number;
  /** Lap in progress at pit exit; one later than `lap` when the line is crossed in the pits. */
  exitLap: number;
  entryTimeS: number | null;
  exitTimeS: number | null;
  /** Time spent in the pit stall. */
  stationaryS: number;
  /** Fuel the car took on in the pits, litres (0 when it only passed through). */
  fuelAddedL: number;
}

interface Visit {
  lap: number;
  entryTimeS: number | null;
  stationaryS: number;
  fuelAddedL: number;
}

/** Longest time step counted as stationary, so that a gap in the data cannot add minutes. */
const MAX_STEP_S = 1;
/** Fuel rises smaller than this are sensor noise. */
const FUEL_NOISE_L = 0.01;

/**
 * Finds pit road visits of the player. A visit counts when both its entry and its exit were seen,
 * so starting a session in the garage is not a stop.
 */
export class PitStopTracker {
  private onPitRoad: boolean | null = null;
  private visit: Visit | null = null;
  private lastTickS: number | null = null;
  private lastFuelL: number | null = null;
  private lastInStall = false;
  /** The car was driving in the world on the previous tick (not in the garage or between spots). */
  private lastInWorld = false;

  update(state: SimState): PitStopEvent | null {
    const car = playerCar(state);
    if (car === null || car.onPitRoad === null) return null;
    const now = car.onPitRoad;
    const tickS = state.tickTimeS;
    const fuelL = state.player.fuelL;
    const was = this.onPitRoad;
    let finished: PitStopEvent | null = null;

    // A visit starts when a car that was driving turns onto pit road. Getting into the car, a
    // reset to the pits or a tow put it on pit road, often straight into the stall, without
    // driving there: those are teleports, not stops.
    const drove = this.lastInWorld && car.inPitStall !== true;
    if (was === false && now && drove) {
      this.visit = { lap: lapInProgress(car), entryTimeS: tickS, stationaryS: 0, fuelAddedL: 0 };
    } else if (this.visit !== null && now) {
      this.accumulate(this.visit, car, tickS, fuelL);
    } else if (this.visit !== null && !now) {
      finished = {
        lap: this.visit.lap,
        exitLap: lapInProgress(car),
        entryTimeS: this.visit.entryTimeS,
        exitTimeS: tickS,
        stationaryS: this.visit.stationaryS,
        fuelAddedL: this.visit.fuelAddedL,
      };
      this.visit = null;
    }
    this.onPitRoad = now;
    this.lastTickS = tickS;
    this.lastFuelL = fuelL;
    this.lastInStall = car.inPitStall === true;
    this.lastInWorld = inWorld(car);
    return finished;
  }

  private accumulate(visit: Visit, car: Car, tickS: number | null, fuelL: number | null): void {
    if (car.inPitStall === true && this.lastInStall && tickS !== null && this.lastTickS !== null) {
      visit.stationaryS += Math.min(MAX_STEP_S, Math.max(0, tickS - this.lastTickS));
    }
    if (fuelL !== null && this.lastFuelL !== null && fuelL - this.lastFuelL > FUEL_NOISE_L) {
      visit.fuelAddedL += fuelL - this.lastFuelL;
    }
  }
}

function inWorld(car: Car): boolean {
  return car.connected && car.isOnTrack !== false && (car.lapDistPct ?? 0) >= 0;
}

export interface StintStart {
  startLap: number;
  /** Fuel taken on in the stop that began the stint; null for the first stint. */
  fuelAddedAtStartL: number | null;
}

export interface StintTransition {
  /** The stint that ended, with the lap it ended on. */
  endedAtLap: number;
  next: StintStart;
}

/**
 * Splits a session into stints at pit stops where the car stood in its stall. A drive-through
 * pass is a pit stop row but does not end the stint.
 */
export class StintTracker {
  /** The stop that ends a stint, or null when it does not. */
  onPitStop(stop: PitStopEvent): StintTransition | null {
    if (stop.stationaryS <= 0) return null;
    return {
      endedAtLap: stop.lap,
      next: { startLap: stop.exitLap, fuelAddedAtStartL: stop.fuelAddedL },
    };
  }
}
