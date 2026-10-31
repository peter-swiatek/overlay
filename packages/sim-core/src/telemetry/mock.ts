import { emptyCar, emptySimState, type Car, type SimState } from "../model";

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
    state.conditions = { airTempC: 22, trackTempC: 31, wetness: 0 };

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
    return state;
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
    return car;
  }
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
