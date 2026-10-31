import {
  emptyCar,
  emptyFlags,
  emptySimState,
  type Car,
  type CarLeftRight,
  type Flags,
  type SessionPhase,
  type SessionTiming,
  type SimState,
  type TyreCorner,
  type TyreSet,
  type Vec3,
} from "../../model/sim-state";
import { IracingDecoder, type VarReader } from "./decoder";
import type { IracingDriver, IracingSessionEntry, IracingSessionInfo } from "./session-yaml";

/** iRacing's "no limit" markers. */
const LAPS_UNLIMITED = 32767;
const TIME_UNLIMITED_S = 604800;

/** irsdk_Flags bits we show. */
const FLAG_CHECKERED = 0x1;
const FLAG_WHITE = 0x2;
const FLAG_GREEN = 0x4;
const FLAG_YELLOW = 0x8 | 0x100;
const FLAG_RED = 0x10;
const FLAG_BLUE = 0x20;
const FLAG_CAUTION = 0x4000 | 0x8000;
// Not mapped, SimState has no slot: furled black (0x80000, a warning), repair/meatball
// (0x100000) and debris (0x80).
const FLAG_BLACK = 0x10000 | 0x20000;

/** irsdk_EngineWarnings: pit speed limiter. */
const ENGINE_PIT_LIMITER = 0x10;

const TRACK_SURFACE_NOT_IN_WORLD = -1;
const TRACK_SURFACE_IN_PIT_STALL = 1;

const PHASES: Record<number, SessionPhase> = {
  1: "garage",
  2: "gridding",
  3: "formation",
  4: "racing",
  5: "checkered",
  6: "cooldown",
};

const CAR_LEFT_RIGHT: Record<number, CarLeftRight> = {
  1: "clear",
  2: "left",
  3: "right",
  4: "both",
  5: "twoLeft",
  6: "twoRight",
};

type Corner = "LF" | "RF" | "LR" | "RR";

/** Turns one irsdk var buffer (plus the parsed session info) into a {@link SimState}. */
export class IracingAdapter {
  constructor(private readonly decoder: IracingDecoder) {}

  static fromHeaderBytes(bytes: Uint8Array): IracingAdapter {
    return new IracingAdapter(IracingDecoder.fromHeaderBytes(bytes));
  }

  /**
   * @param varBuffer the var buffer only (for a fixture record, the payload after its u32 tick)
   * @param info parsed session info; null before the first YAML arrives
   */
  toSimState(varBuffer: Uint8Array, info: IracingSessionInfo | null): SimState {
    const r = this.decoder.reader(varBuffer);
    const state = emptySimState("iracing");
    state.connected = true;
    state.sim = "iracing";
    state.tickTimeS = r.number("SessionTime");
    state.playerCarIdx = validIndex(r.number("PlayerCarIdx"));
    state.focusCarIdx = validIndex(r.number("CamCarIdx"));
    fillSession(state, r, info);
    state.conditions = {
      airTempC: r.number("AirTemp"),
      trackTempC: r.number("TrackTempCrew"),
      wetness: wetness(r.number("TrackWetness")),
    };
    state.flags = flags(r.number("SessionFlags"));
    state.cars = buildCars(r, info, state.playerCarIdx);
    fillPlayer(state, r, info);
    return state;
  }
}

function fillSession(state: SimState, r: VarReader, info: IracingSessionInfo | null): void {
  const sessionNum = r.number("SessionNum");
  const entry = findSession(info, sessionNum);
  const timeTotal = positiveBelow(r.number("SessionTimeTotal"), TIME_UNLIMITED_S);
  const lapsVar = r.number("SessionLapsTotal");
  // Without the live value, the lap limit of the session's YAML entry stands in for it. An
  // "unlimited" live value is an answer, so it is not overridden.
  const lapsTotal = positiveBelow(
    lapsVar === null ? (entry?.lapsLimit ?? null) : lapsVar,
    LAPS_UNLIMITED,
  );
  const s = state.session;
  s.type = entry?.type ?? null;
  s.phase = phase(r.number("SessionState"));
  s.timing = timing(lapsTotal, timeTotal);
  s.timeRemainingS = nonNegativeBelow(r.number("SessionTimeRemain"), TIME_UNLIMITED_S);
  s.timeTotalS = timeTotal;
  s.lapsRemaining = nonNegativeBelow(r.number("SessionLapsRemainEx"), LAPS_UNLIMITED);
  s.lapsTotal = lapsTotal;
  s.trackName = info?.trackName ?? null;
  s.trackConfig = info?.trackConfig ?? null;
  s.trackLengthM = info?.trackLengthM ?? null;
  s.pitSpeedLimitMps = info?.pitSpeedLimitMps ?? null;
}

function findSession(
  info: IracingSessionInfo | null,
  sessionNum: number | null,
): IracingSessionEntry | undefined {
  return sessionNum === null ? undefined : info?.sessions.find((x) => x.sessionNum === sessionNum);
}

function timing(lapsTotal: number | null, timeTotal: number | null): SessionTiming | null {
  if (lapsTotal !== null && timeTotal !== null) return "laps-or-time";
  if (lapsTotal !== null) return "laps";
  return timeTotal !== null ? "time" : null;
}

function phase(value: number | null): SessionPhase | null {
  return value === null ? null : (PHASES[value] ?? null);
}

function wetness(value: number | null): number | null {
  if (value === null || value < 1 || value > 7) return null;
  return (value - 1) / 6;
}

function flags(bits: number | null): Flags | null {
  if (bits === null) return null;
  const f = emptyFlags();
  f.checkered = (bits & FLAG_CHECKERED) !== 0;
  f.white = (bits & FLAG_WHITE) !== 0;
  f.green = (bits & FLAG_GREEN) !== 0;
  f.yellow = (bits & FLAG_YELLOW) !== 0;
  f.red = (bits & FLAG_RED) !== 0;
  f.blue = (bits & FLAG_BLUE) !== 0;
  f.fullCourseYellow = (bits & FLAG_CAUTION) !== 0;
  f.black = (bits & FLAG_BLACK) !== 0;
  return f;
}

function buildCars(r: VarReader, info: IracingSessionInfo | null, playerCarIdx: number | null) {
  const drivers: IracingDriver[] = info?.drivers ?? [];
  const cars: Car[] = [];
  const count = r.info("CarIdxPosition")?.count ?? 0;
  // Without session info we can still list cars the sim reports as present.
  const present =
    info === null
      ? Array.from({ length: count }, (_, i) => i).filter(
          (i) => (r.number("CarIdxClass", i) ?? -1) >= 0,
        )
      : [];
  const byIdx = new Map(drivers.map((d) => [d.carIdx, d]));
  const indices = info === null ? present : [...byIdx.keys()].sort((a, b) => a - b);
  for (const carIdx of indices) {
    if (carIdx >= count) continue;
    cars.push(buildCar(r, carIdx, byIdx.get(carIdx), playerCarIdx));
  }
  return cars;
}

function buildCar(
  r: VarReader,
  carIdx: number,
  driver: IracingDriver | undefined,
  playerCarIdx: number | null,
): Car {
  const car = emptyCar(carIdx);
  const surface = r.number("CarIdxTrackSurface", carIdx);
  const inWorld = surface !== null && surface !== TRACK_SURFACE_NOT_IN_WORLD;
  if (driver !== undefined) {
    car.driverName = driver.driverName;
    car.carName = driver.carName;
    car.classId = driver.classId;
    car.className = driver.className;
    car.classColour = driver.classColour;
    car.carNumber = driver.carNumber;
    car.iRating = driver.iRating;
    car.license = driver.license;
    car.isPaceCar = driver.isPaceCar;
  }
  car.position = atLeast(r.number("CarIdxPosition", carIdx), 1);
  car.classPosition = atLeast(r.number("CarIdxClassPosition", carIdx), 1);
  car.lapsCompleted = atLeast(r.number("CarIdxLapCompleted", carIdx), 0);
  car.lapInProgress = atLeast(r.number("CarIdxLap", carIdx), 1);
  const pct = r.number("CarIdxLapDistPct", carIdx);
  car.lapDistPct = pct === null || pct < 0 ? null : Math.min(pct, 1);
  car.onPitRoad = r.bool("CarIdxOnPitRoad", carIdx);
  car.inPitStall = surface === null ? null : surface === TRACK_SURFACE_IN_PIT_STALL;
  car.isOnTrack = surface === null ? null : surface >= 0;
  car.lastLapS = positive(r.number("CarIdxLastLapTime", carIdx));
  car.bestLapS = positive(r.number("CarIdxBestLapTime", carIdx));
  car.estTimeS = inWorld ? atLeast(r.number("CarIdxEstTime", carIdx), 0) : null;
  car.isPlayer = playerCarIdx === null ? null : playerCarIdx === carIdx;
  // iRacing has no connected flag. CarIdxClass cannot tell (the pace car's slot is -1 while it
  // drives), so a car counts as connected while it is in the world; a driver sitting in the
  // garage reads as not connected.
  car.connected = inWorld;
  return car;
}

function fillPlayer(state: SimState, r: VarReader, info: IracingSessionInfo | null): void {
  const p = state.player;
  const player = state.playerCarIdx;
  const surface = player === null ? null : r.number("CarIdxTrackSurface", player);
  // The player-car vars always describe the player's own car, whatever the camera shows. They
  // are stale when there is no player car or it is out of the world (garage, spectating).
  const driving = player !== null && surface !== null && surface !== TRACK_SURFACE_NOT_IN_WORLD;
  const live = <T>(value: T | null): T | null => (driving ? value : null);
  p.inputs = {
    throttle: live(unit(r.number("Throttle"))),
    brake: live(unit(r.number("Brake"))),
    // iRacing reports the clutch as 1 = pedal released.
    clutch: live(invert(unit(r.number("Clutch")))),
    steer: live(steer(r.number("SteeringWheelAngle"), r.number("SteeringWheelAngleMax"))),
  };
  p.gear = live(r.number("Gear"));
  p.speedMps = live(r.number("Speed"));
  p.rpm = live(r.number("RPM"));
  p.fuelL = live(atLeast(r.number("FuelLevel"), 0));
  p.fuelCapacityL = info?.fuelCapacityL ?? null;
  p.tyres = driving ? tyres(r) : null;
  p.incidentCount = r.number("PlayerCarMyIncidentCount");
  const warnings = r.number("EngineWarnings");
  p.pitLimiter = !driving || warnings === null ? null : (warnings & ENGINE_PIT_LIMITER) !== 0;
  const lr = r.number("CarLeftRight");
  p.carLeftRight = !driving || lr === null ? null : (CAR_LEFT_RIGHT[lr] ?? null);
  p.yawRad = live(r.number("YawNorth"));
  p.velocityMps = live(velocity(r));
}

/** Car-frame velocity: X forward, Y to the left, Z up (checked against Speed in recordings). */
function velocity(r: VarReader): Vec3 | null {
  const x = r.number("VelocityX");
  const y = r.number("VelocityY");
  const z = r.number("VelocityZ");
  return x === null || y === null || z === null ? null : { x, y, z };
}

/** iRacing: positive wheel angle is to the left; SimState: positive is right. */
function steer(angle: number | null, max: number | null): number | null {
  if (angle === null || max === null || max <= 0) return null;
  return clamp(-angle / max, -1, 1) + 0; // + 0 turns -0 into 0
}

function tyres(r: VarReader): TyreSet | null {
  const set: TyreSet = {
    fl: corner(r, "LF", "left"),
    fr: corner(r, "RF", "right"),
    rl: corner(r, "LR", "left"),
    rr: corner(r, "RR", "right"),
  };
  const any = [set.fl, set.fr, set.rl, set.rr].some(
    (c) => c.wear !== null || c.temps.inner !== null || c.temps.middle !== null,
  );
  return any ? set : null;
}

/** The "L" column is the outer edge on a left tyre and the inner edge on a right tyre. */
function corner(r: VarReader, prefix: Corner, side: "left" | "right"): TyreCorner {
  const l = temperature(r.number(`${prefix}tempCL`));
  const m = temperature(r.number(`${prefix}tempCM`));
  const right = temperature(r.number(`${prefix}tempCR`));
  return {
    temps: {
      inner: side === "left" ? right : l,
      middle: m,
      outer: side === "left" ? l : right,
    },
    // iRacing only exposes the cold pressure while driving.
    pressureKpa: null,
    wear: wear(r, prefix),
  };
}

/** Tread remaining is 0..1 per third of the tyre; wear is one minus the mean. */
function wear(r: VarReader, prefix: Corner): number | null {
  const parts = [`${prefix}wearL`, `${prefix}wearM`, `${prefix}wearR`].map((n) => r.number(n));
  if (parts.some((v) => v === null)) return null;
  const values = parts as number[];
  if (values.every((v) => v === 0)) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return clamp(1 - mean, 0, 1);
}

function temperature(value: number | null): number | null {
  return value === null || value === 0 ? null : value;
}

function validIndex(value: number | null): number | null {
  return value === null || value < 0 ? null : value;
}

function atLeast(value: number | null, min: number): number | null {
  return value === null || value < min ? null : value;
}

function positive(value: number | null): number | null {
  return value === null || value <= 0 ? null : value;
}

function positiveBelow(value: number | null, limit: number): number | null {
  return value === null || value <= 0 || value >= limit ? null : value;
}

function nonNegativeBelow(value: number | null, limit: number): number | null {
  return value === null || value < 0 || value >= limit ? null : value;
}

function unit(value: number | null): number | null {
  return value === null ? null : clamp(value, 0, 1);
}

function invert(value: number | null): number | null {
  return value === null ? null : 1 - value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
