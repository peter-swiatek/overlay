import { emptyCar, emptyFlags, emptySimState, type Car, type SimState } from "../model";

export interface MockSourceOptions {
  /** Cars on track, player included. Default 20. */
  carCount?: number;
}

const GT3 = { id: "1", name: "GT3", colour: "#ffda59", lapS: 100 };
const HYPER = { id: "2", name: "Hypercar", colour: "#ff5888", lapS: 86 };
const TRACK_LENGTH_M = 5000;
const FUEL_CAPACITY_L = 60;
const FUEL_PER_LAP_L = 2.4;
const REFUEL_BELOW_L = 4;
const RACE_LAPS = 40;
/** Delta channels report `ok: false` for this long at the start of each lap, seconds. */
const DELTA_SETTLE_S = 2;
/** Brake pedal level above which the demo ABS cuts in. */
const ABS_BRAKE_LEVEL = 0.8;
/** Car that is periodically under a local yellow, and the car that needs repair. */
const YELLOW_CAR = 3;
const REPAIR_CAR = 7;
/** Car that runs wide once per lap, and the lap fraction range it is off track. */
const OFF_TRACK_CAR = 5;
const OFF_TRACK_FROM = 0.3;
const OFF_TRACK_TO = 0.34;

/**
 * A deterministic synthetic race for UI work without a sim: about 20 cars in two classes, the
 * player (carIdx 0, a GT3 car) burning fuel and topping up when low. Advance it with `step`;
 * the same sequence of steps always gives the same states.
 */
export class MockSource {
  private timeS = 0;
  private readonly carCount: number;

  constructor(options: MockSourceOptions = {}) {
    this.carCount = Math.max(2, options.carCount ?? 20);
  }

  get tickTimeS(): number {
    return this.timeS;
  }

  step(dtS: number): SimState {
    this.timeS += dtS;
    return this.state();
  }

  state(): SimState {
    const state = emptySimState("mock");
    const distances = Array.from({ length: this.carCount }, (_, i) => this.distance(i));
    const order = distances.map((d, i) => ({ d, i })).sort((a, b) => b.d - a.d || a.i - b.i);
    const overall = new Map(order.map((o, rank) => [o.i, rank + 1]));
    const perClass = new Map<string, number>();
    const classRank = new Map<number, number>();
    for (const o of order) {
      const next = (perClass.get(classOf(o.i).id) ?? 0) + 1;
      perClass.set(classOf(o.i).id, next);
      classRank.set(o.i, next);
    }

    state.connected = true;
    state.tickTimeS = this.timeS;
    state.playerCarIdx = 0;
    state.focusCarIdx = 0;
    state.cars = distances.map((d, i) =>
      this.car(i, d, overall.get(i) ?? 1, classRank.get(i) ?? 1),
    );
    const playerDistance = distances[0] ?? 0;
    const s = state.session;
    s.type = "race";
    s.phase = "racing";
    s.timing = "laps";
    s.lapsTotal = RACE_LAPS;
    s.lapsRemaining = Math.max(0, RACE_LAPS - Math.floor(playerDistance));
    s.trackName = "Mock Raceway";
    s.trackLengthM = TRACK_LENGTH_M;
    s.pitSpeedLimitMps = 22.2;
    s.typeName = "Race";
    s.trackUsage = "moderate usage";
    state.conditions = {
      ...state.conditions,
      airTempC: 22,
      trackTempC: 31,
      wetness: 0,
      humidity: 0.55,
      windSpeedMps: 4.5,
      windDirRad: 1.2,
      declaredWet: false,
    };

    const p = state.player;
    p.gear = 4;
    p.speedMps = 40 + 15 * Math.sin(this.timeS / 3);
    p.rpm = 6500 + 1500 * Math.sin(this.timeS);
    p.inputs = {
      throttle: 0.5 + 0.5 * Math.sin(this.timeS * 1.3),
      brake: Math.max(0, -Math.sin(this.timeS * 1.3)),
      clutch: 0,
      steer: 0.4 * Math.sin(this.timeS / 2),
    };
    p.fuelCapacityL = FUEL_CAPACITY_L;
    p.fuelL = fuelAt(playerDistance);
    p.incidentCount = 0;
    p.lap = this.playerLap(playerDistance);
    p.absActive = (p.inputs.brake ?? 0) > ABS_BRAKE_LEVEL;
    p.trackSurface = "onTrack";
    p.isOnTrack = true;
    p.shiftLights = { firstRpm: 5200, shiftRpm: 7600, lastRpm: 7400, blinkRpm: 7800 };
    p.redlineRpm = 8000;
    p.steerMaxRad = 7.85;
    return state;
  }

  /** The player's lap timing; the three delta channels are smooth sinusoids of time into the lap. */
  private playerLap(distance: number): NonNullable<SimState["player"]["lap"]> {
    const lapS = lapTimeOf(0);
    const lapsCompleted = Math.floor(distance);
    const intoS = (distance - lapsCompleted) * lapS;
    const ok = intoS >= DELTA_SETTLE_S;
    const channel = (amp: number, freq: number, phase: number) => ({
      s: amp * Math.sin(freq * intoS + phase),
      ok,
      rate: amp * freq * Math.cos(freq * intoS + phase),
    });
    return {
      currentLapS: intoS,
      lastLapS: lapsCompleted >= 1 ? lapS : null,
      bestLapS: lapsCompleted >= 1 ? lapS - 0.4 : null,
      delta: {
        best: channel(0.35, 0.21, 0),
        sessionBest: channel(0.6, 0.17, 1),
        sessionLast: channel(0.25, 0.26, 2),
      },
    };
  }

  private carFlags(index: number): ReturnType<typeof emptyFlags> {
    const flags = emptyFlags();
    if (index === YELLOW_CAR) flags.yellow = this.timeS % 30 < 10;
    if (index === REPAIR_CAR) flags.repair = true;
    return flags;
  }

  private distance(index: number): number {
    // Cars start staggered behind the line, faster cars catch the slower ones in time.
    const offset = (this.carCount - index) * 0.012;
    return offset + this.timeS / lapTimeOf(index);
  }

  private car(index: number, distance: number, position: number, classPosition: number): Car {
    const cls = classOf(index);
    const car = emptyCar(index);
    const lapsCompleted = Math.floor(distance);
    car.driverName = `Mock Driver ${index}`;
    car.carName = cls.name;
    car.classId = cls.id;
    car.className = cls.name;
    car.classColour = cls.colour;
    car.carNumber = String(index + 1);
    car.position = position;
    car.classPosition = classPosition;
    car.lapsCompleted = lapsCompleted;
    car.lapInProgress = lapsCompleted + 1;
    car.lapDistPct = distance - lapsCompleted;
    car.onPitRoad = false;
    car.inPitStall = false;
    car.isOnTrack = true;
    car.lastLapS = lapsCompleted >= 1 ? lapTimeOf(index) : null;
    car.bestLapS = lapsCompleted >= 1 ? lapTimeOf(index) - 0.4 : null;
    car.estTimeS = (distance - lapsCompleted) * lapTimeOf(index);
    car.isPaceCar = false;
    car.isPlayer = index === 0;
    car.iRating = 2000 + index * 50;
    car.license = "A 3.00";
    car.connected = true;
    car.flags = this.carFlags(index);
    car.trackSurface = carSurface(index, distance - lapsCompleted);
    if (cls === HYPER) {
      car.p2pCount = 10 - ((Math.floor(this.timeS / 15) + index) % 11);
      car.p2pActive = this.timeS % 15 < 3;
    }
    return car;
  }
}

function carSurface(index: number, lapFraction: number): NonNullable<Car["trackSurface"]> {
  const wide =
    index === OFF_TRACK_CAR && lapFraction >= OFF_TRACK_FROM && lapFraction < OFF_TRACK_TO;
  return wide ? "offTrack" : "onTrack";
}

function classOf(index: number): typeof GT3 {
  return index % 5 === 4 ? HYPER : GT3;
}

function lapTimeOf(index: number): number {
  return classOf(index).lapS * (1 + (index % 7) * 0.004);
}

/** Fuel after `laps` laps from a full-ish start, topped up whenever it would fall below the floor. */
function fuelAt(laps: number): number {
  const start = FUEL_CAPACITY_L - 5;
  const used = laps * FUEL_PER_LAP_L;
  const usable = start - REFUEL_BELOW_L;
  const stintLength = FUEL_CAPACITY_L - REFUEL_BELOW_L;
  if (used < usable) return start - used;
  const sinceFirstStop = used - usable;
  return FUEL_CAPACITY_L - (sinceFirstStop % stintLength);
}
