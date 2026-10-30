import {
  emptyCar,
  emptySimState,
  type Car,
  type Flags,
  type SessionInfo,
  type SessionPhase,
  type SessionTiming,
  type SessionType,
  type SimState,
  type TyreCorner,
  type TyreSet,
} from "../../model";
import {
  HEADER,
  LMU_MAX_VEHICLES,
  LMU_USED_BYTES,
  SCORING_BASE,
  SESSION,
  TELEM,
  TELEMETRY,
  TELEMETRY_BASE,
  VEHICLE,
  VEHICLE_ROWS_OFFSET,
  VEHICLE_STRIDE,
  WHEEL,
  WHEEL_COUNT,
} from "./layout";
import { applyRestResponse, emptyRestSnapshot, type LmuRestSnapshot } from "./rest";

export interface LmuDecodeResult {
  /** `connected: false` and otherwise empty when `error` is set. */
  state: SimState;
  error: string | null;
  /** Things worth showing but not worth refusing the frame for. */
  warnings: string[];
}

export interface LmuDecoderOptions {
  /** Game builds the layout was checked against; any other build only adds a warning. */
  validatedGameVersions?: readonly number[];
}

/** The build the layout in layout.ts was derived from. */
export const LMU_VALIDATED_GAME_VERSIONS: readonly number[] = [14200];

const KELVIN = 273.15;
/** `maxLaps` and end times at or above these mean "no limit" (the sim writes INT_MAX). */
const MAX_REAL_LAPS = 1_000_000;
const MAX_REAL_END_ET_S = 1_000_000;

/** A raw plausibility window; a value outside it means the layout is wrong or the frame is torn. */
interface Window {
  name: string;
  lo: number;
  hi: number;
}

const W = {
  gameVersion: { name: "gameVersion", lo: 1, hi: 10_000_000 },
  vehicles: { name: "vehicle count", lo: 0, hi: LMU_MAX_VEHICLES },
  trackLength: { name: "track length m", lo: 100, hi: 100_000 },
  et: { name: "session time s", lo: -100_000, hi: 100_000_000 },
  ambient: { name: "ambient temp C", lo: -60, hi: 80 },
  trackTemp: { name: "track temp C", lo: -60, hi: 150 },
  wetness: { name: "wetness", lo: -0.001, hi: 1.001 },
  laps: { name: "laps", lo: 0, hi: 100_000 },
  place: { name: "place", lo: 0, hi: 255 },
  pitState: { name: "pit state", lo: 0, hi: 8 },
  rpm: { name: "rpm", lo: 0, hi: 30_000 },
  gear: { name: "gear", lo: -2, hi: 12 },
  pedal: { name: "pedal", lo: -0.01, hi: 1.01 },
  steer: { name: "steering", lo: -1.01, hi: 1.01 },
  fuel: { name: "fuel L", lo: -0.01, hi: 1000 },
  speed: { name: "speed m/s", lo: 0, hi: 200 },
  tyreK: { name: "tyre temp K", lo: 200, hi: 700 },
  pressure: { name: "tyre pressure kPa", lo: 0, hi: 1000 },
  wear: { name: "tyre wear", lo: -0.001, hi: 1.001 },
} as const satisfies Record<string, Window>;

function outside(w: Window, value: number): string | null {
  return Number.isFinite(value) && value >= w.lo && value <= w.hi
    ? null
    : `${w.name} ${value} outside ${w.lo}..${w.hi}`;
}

/** Typed little-endian reads at absolute buffer offsets. */
class Frame {
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8 = (o: number): number => this.view.getUint8(o);
  i8 = (o: number): number => this.view.getInt8(o);
  i16 = (o: number): number => this.view.getInt16(o, true);
  i32 = (o: number): number => this.view.getInt32(o, true);
  f32 = (o: number): number => this.view.getFloat32(o, true);
  f64 = (o: number): number => this.view.getFloat64(o, true);
  /** NUL-terminated text, decoded as latin1 (names the sim writes as ANSI). */
  text(o: number, length: number): string {
    const slice = this.bytes.subarray(o, o + length);
    const end = slice.indexOf(0);
    return Buffer.from(end < 0 ? slice : slice.subarray(0, end)).toString("latin1");
  }
  get length(): number {
    return this.bytes.length;
  }
}

function failed(error: string): LmuDecodeResult {
  return { state: emptySimState("lmu"), error, warnings: [] };
}

export class LmuDecoder {
  private rest: LmuRestSnapshot = emptyRestSnapshot();
  private readonly validated: readonly number[];

  constructor(options: LmuDecoderOptions = {}) {
    this.validated = options.validatedGameVersions ?? LMU_VALIDATED_GAME_VERSIONS;
  }

  /** Feeds a recorded REST response (`/rest/watch/standings` or `/rest/watch/sessionInfo`). */
  observeRest(response: { path: string; status?: number; body: unknown }): void {
    this.rest = applyRestResponse(this.rest, response);
  }

  decode(buffer: Uint8Array): LmuDecodeResult {
    if (buffer.length < LMU_USED_BYTES) {
      return failed(`LMU_Data is ${buffer.length} bytes, expected at least ${LMU_USED_BYTES}`);
    }
    const f = new Frame(buffer);
    const warnings: string[] = [];
    const problem = validateFrame(f);
    if (problem) return failed(problem);

    const version = f.i32(HEADER.gameVersion);
    if (!this.validated.includes(version)) {
      warnings.push(`game build ${version} was not validated against this layout`);
    }
    const active = f.u8(TELEMETRY_BASE + TELEMETRY.activeVehicles);
    const count = f.i32(SCORING_BASE + SESSION.numVehicles);
    if (active !== count) warnings.push(`scoring has ${count} vehicles, telemetry ${active}`);

    const trackLengthM = f.f64(SCORING_BASE + SESSION.lapDist);
    const cars = readCars(f, count, trackLengthM, this.rest);
    markClassPositions(cars);
    const playerRow = findPlayerRow(f, count);
    const playerId = playerRow === null ? null : f.i32(playerRow + VEHICLE.id);
    const state = emptySimState("lmu");
    state.connected = true;
    state.tickTimeS = f.f64(SCORING_BASE + SESSION.currentEt);
    state.cars = cars;
    state.playerCarIdx = playerId;
    state.focusCarIdx = playerId;
    state.session = readSession(f, trackLengthM, playerRow, this.rest);
    state.conditions = {
      airTempC: f.f64(SCORING_BASE + SESSION.ambientTemp),
      trackTempC: f.f64(SCORING_BASE + SESSION.trackTemp),
      wetness: clamp01(f.f64(SCORING_BASE + SESSION.avgPathWetness)),
    };
    state.flags = playerRow === null ? null : readFlags(f, playerRow);

    const telemetryRow = playerId === null ? null : findTelemetryRow(f, playerId);
    if (telemetryRow !== null) readPlayer(f, telemetryRow, state);
    return { state, error: null, warnings };
  }
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

function validateFrame(f: Frame): string | null {
  const s = SCORING_BASE;
  const count = f.i32(s + SESSION.numVehicles);
  const first =
    outside(W.gameVersion, f.i32(HEADER.gameVersion)) ??
    outside(W.vehicles, count) ??
    outside(W.vehicles, f.u8(TELEMETRY_BASE + TELEMETRY.activeVehicles)) ??
    outside(W.et, f.f64(s + SESSION.currentEt)) ??
    outside(W.ambient, f.f64(s + SESSION.ambientTemp)) ??
    outside(W.trackTemp, f.f64(s + SESSION.trackTemp)) ??
    outside(W.wetness, f.f64(s + SESSION.avgPathWetness));
  if (first) return first;
  const trackLength = f.f64(s + SESSION.lapDist);
  // A loading game has no track yet: zero length and no cars.
  if (count > 0 || trackLength !== 0) {
    const bad = outside(W.trackLength, trackLength);
    if (bad) return bad;
  }
  for (let i = 0; i < count; i++) {
    const bad = validateVehicleRow(f, VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE, trackLength);
    if (bad) return `vehicle row ${i}: ${bad}`;
  }
  return validatePlayerTelemetry(f);
}

function validateVehicleRow(f: Frame, o: number, trackLength: number): string | null {
  const slack = trackLength * 0.1 + 50;
  return (
    outside(W.laps, f.i16(o + VEHICLE.totalLaps)) ??
    outside(W.place, f.u8(o + VEHICLE.place)) ??
    outside(W.pitState, f.u8(o + VEHICLE.pitState)) ??
    outside(
      { name: "lap distance m", lo: -slack, hi: trackLength + slack },
      f.f64(o + VEHICLE.lapDist),
    )
  );
}

/**
 * The player's telemetry row. A player who is not driving (menu, garage screen) has an all-zero
 * row, which is "no data", not a wrong layout.
 */
function validatePlayerTelemetry(f: Frame): string | null {
  const t = TELEMETRY_BASE;
  if (f.u8(t + TELEMETRY.playerHasVehicle) === 0) return null;
  const idx = f.u8(t + TELEMETRY.playerVehicleIdx);
  if (idx >= LMU_MAX_VEHICLES) return `player vehicle index ${idx} out of range`;
  const o = telemetryRowOffset(idx);
  if (f.f64(o + TELEM.engineMaxRpm) === 0) return null;
  const speed = Math.hypot(
    f.f64(o + TELEM.localVel),
    f.f64(o + TELEM.localVel + 8),
    f.f64(o + TELEM.localVel + 16),
  );
  const bad =
    outside(W.rpm, f.f64(o + TELEM.rpm)) ??
    outside(W.gear, f.i32(o + TELEM.gear)) ??
    outside(W.pedal, f.f64(o + TELEM.throttle)) ??
    outside(W.pedal, f.f64(o + TELEM.brake)) ??
    outside(W.pedal, f.f64(o + TELEM.clutch)) ??
    outside(W.steer, f.f64(o + TELEM.steering)) ??
    outside(W.fuel, f.f64(o + TELEM.fuel)) ??
    outside(W.fuel, f.f64(o + TELEM.fuelCapacity)) ??
    outside(W.speed, speed);
  if (bad) return `player telemetry: ${bad}`;
  const capacity = f.f64(o + TELEM.fuelCapacity);
  if (f.f64(o + TELEM.fuel) > capacity * 1.01 + 0.5)
    return "player telemetry: fuel above tank size";
  for (let w = 0; w < WHEEL_COUNT; w++) {
    const wo = wheelOffset(o, w);
    if (isAbsentWheel(f, wo)) continue;
    const wheelBad =
      outside(W.tyreK, f.f64(wo + WHEEL.temps)) ??
      outside(W.tyreK, f.f64(wo + WHEEL.temps + 8)) ??
      outside(W.tyreK, f.f64(wo + WHEEL.temps + 16)) ??
      outside(W.pressure, f.f64(wo + WHEEL.pressure)) ??
      outside(W.wear, f.f64(wo + WHEEL.wear));
    if (wheelBad) return `player telemetry wheel ${w}: ${wheelBad}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Session, cars, player
// ---------------------------------------------------------------------------------------------

function telemetryRowOffset(index: number): number {
  return TELEMETRY_BASE + TELEMETRY.rowsOffset + index * TELEMETRY.rowStride;
}

function wheelOffset(row: number, wheel: number): number {
  return row + TELEM.wheelsOffset + wheel * TELEM.wheelStride;
}

function isAbsentWheel(f: Frame, wo: number): boolean {
  return f.f64(wo + WHEEL.temps) === 0 && f.f64(wo + WHEEL.temps + 8) === 0;
}

export function sessionTypeOf(code: number, restSession: string | null): SessionType | null {
  // 0 test day, 1-4 practice, 5-8 qualifying, 9 warm-up, 10-13 race. Only practice is observed.
  if (code === 0) return "other";
  if (code >= 1 && code <= 4) return "practice";
  if (code >= 5 && code <= 8) return "qualifying";
  if (code === 9) return "warmup";
  if (code >= 10 && code <= 13) return "race";
  if (restSession === null) return null;
  if (restSession.startsWith("PRACTICE")) return "practice";
  if (restSession.startsWith("QUALIFY")) return "qualifying";
  if (restSession.startsWith("WARMUP")) return "warmup";
  if (restSession.startsWith("RACE")) return "race";
  return null;
}

/** gamePhase: 0 before, 1 recon laps, 2 grid walk, 3 formation, 4 countdown, 5 green, 6 FCY, 7 stopped, 8 over. */
export function phaseOf(gamePhase: number, playerFinished: boolean): SessionPhase | null {
  switch (gamePhase) {
    case 0:
      return "garage";
    case 1:
    case 3:
      return "formation";
    case 2:
    case 4:
      return "gridding";
    case 5:
    case 6:
    case 7:
      return playerFinished ? "checkered" : "racing";
    case 8:
      return "cooldown";
    default:
      return null;
  }
}

function readSession(
  f: Frame,
  trackLengthM: number,
  playerRow: number | null,
  rest: LmuRestSnapshot,
): SessionInfo {
  const s = SCORING_BASE;
  const maxLaps = f.i32(s + SESSION.maxLaps);
  const endEt = f.f64(s + SESSION.endEt);
  const et = f.f64(s + SESSION.currentEt);
  const lapLimited = maxLaps > 0 && maxLaps < MAX_REAL_LAPS;
  const timeLimited = endEt > 0 && endEt < MAX_REAL_END_ET_S;
  let timing: SessionTiming | null = null;
  if (lapLimited && timeLimited) timing = "laps-or-time";
  else if (lapLimited) timing = "laps";
  else if (timeLimited) timing = "time";
  const playerLaps = playerRow === null ? null : f.i16(playerRow + VEHICLE.totalLaps);
  const finished = playerRow !== null && f.i8(playerRow + VEHICLE.finishStatus) === 1;
  const track = f.text(s + SESSION.trackName.offset, SESSION.trackName.length);
  return {
    type: sessionTypeOf(f.i32(s + SESSION.session), rest.session?.session ?? null),
    phase: phaseOf(f.u8(s + SESSION.gamePhase), finished),
    timing,
    timeRemainingS: timeLimited ? Math.max(0, endEt - et) : null,
    timeTotalS: timeLimited ? (rest.session?.maxTimeS ?? endEt) : null,
    lapsRemaining: lapLimited && playerLaps !== null ? Math.max(0, maxLaps - playerLaps) : null,
    lapsTotal: lapLimited ? maxLaps : null,
    trackName: track.length > 0 ? track : null,
    trackLengthM: trackLengthM > 0 ? trackLengthM : null,
    pitSpeedLimitMps: null,
  };
}

function readFlags(f: Frame, playerRow: number): Flags {
  const phase = f.u8(SCORING_BASE + SESSION.gamePhase);
  const yellow = f.u8(playerRow + VEHICLE.underYellow) === 1;
  const fullCourseYellow = phase === 6;
  const red = phase === 7;
  const checkered = phase === 8 || f.i8(playerRow + VEHICLE.finishStatus) === 1;
  const blue = f.u8(playerRow + VEHICLE.flag) === 6;
  return {
    green: phase === 5 && !yellow && !checkered,
    yellow,
    fullCourseYellow,
    red,
    blue,
    white: false,
    checkered,
    black: false,
  };
}

function findPlayerRow(f: Frame, count: number): number | null {
  for (let i = 0; i < count; i++) {
    const o = VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE;
    if (f.u8(o + VEHICLE.isPlayer) === 1) return o;
  }
  return null;
}

function findTelemetryRow(f: Frame, id: number): number | null {
  const t = TELEMETRY_BASE;
  if (f.u8(t + TELEMETRY.playerHasVehicle) === 0) return null;
  const active = Math.min(f.u8(t + TELEMETRY.activeVehicles), LMU_MAX_VEHICLES);
  for (let i = 0; i < active; i++) {
    const o = telemetryRowOffset(i);
    if (f.i32(o + TELEM.id) === id) return o;
  }
  return null;
}

function readCars(f: Frame, count: number, trackLengthM: number, rest: LmuRestSnapshot): Car[] {
  const cars: Car[] = [];
  for (let i = 0; i < count; i++) {
    const o = VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE;
    cars.push(readCar(f, o, trackLengthM, rest));
  }
  return cars;
}

function readCar(f: Frame, o: number, trackLengthM: number, rest: LmuRestSnapshot): Car {
  const id = f.i32(o + VEHICLE.id);
  const car = emptyCar(id);
  const extra = rest.cars.get(id);
  const vehicleName = f.text(o + VEHICLE.vehicleName.offset, VEHICLE.vehicleName.length);
  const klass = f.text(o + VEHICLE.vehicleClass.offset, VEHICLE.vehicleClass.length);
  const className = klass.length > 0 ? klass : (extra?.carClass ?? null);
  const laps = f.i16(o + VEHICLE.totalLaps);
  const inPits = f.u8(o + VEHICLE.inPits) === 1;
  const control = f.i8(o + VEHICLE.control);
  const finishStatus = f.i8(o + VEHICLE.finishStatus);
  const timeIntoLap = f.f64(o + VEHICLE.timeIntoLap);
  const driver = f.text(o + VEHICLE.driverName.offset, VEHICLE.driverName.length);
  car.driverName = driver.length > 0 ? driver : null;
  car.carName = vehicleName.length > 0 ? vehicleName : null;
  car.classId = className;
  car.className = className;
  car.carNumber = extra?.carNumber ?? numberFromVehicleName(vehicleName);
  car.position = f.u8(o + VEHICLE.place) || null;
  car.lapsCompleted = laps;
  car.lapInProgress = laps + 1;
  car.lapDistPct = lapPct(f.f64(o + VEHICLE.lapDist), trackLengthM);
  car.onPitRoad = inPits;
  car.inPitStall = f.u8(o + VEHICLE.pitState) === 3 || f.u8(o + VEHICLE.inGarageStall) === 1;
  car.isOnTrack = control !== -1 && !inPits && finishStatus < 2;
  car.lastLapS = positiveOrNull(f.f64(o + VEHICLE.lastLapTime));
  car.bestLapS = positiveOrNull(f.f64(o + VEHICLE.bestLapTime));
  car.estTimeS = timeIntoLap >= 0 && Number.isFinite(timeIntoLap) ? timeIntoLap : null;
  car.isPlayer = f.u8(o + VEHICLE.isPlayer) === 1;
  car.connected = control !== -1;
  return car;
}

function numberFromVehicleName(name: string): string | null {
  return /#(\w+)/.exec(name)?.[1] ?? null;
}

function lapPct(lapDist: number, trackLengthM: number): number | null {
  if (!(trackLengthM > 0) || !Number.isFinite(lapDist)) return null;
  const pct = (lapDist / trackLengthM) % 1;
  return pct < 0 ? pct + 1 : pct;
}

function positiveOrNull(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Class position = rank by overall place among cars of the same class. */
function markClassPositions(cars: Car[]): void {
  const byClass = new Map<string, Car[]>();
  for (const car of cars) {
    if (car.classId === null || car.position === null) continue;
    const list = byClass.get(car.classId) ?? [];
    list.push(car);
    byClass.set(car.classId, list);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    list.forEach((car, index) => {
      car.classPosition = index + 1;
    });
  }
}

function readPlayer(f: Frame, o: number, state: SimState): void {
  const player = state.player;
  if (f.f64(o + TELEM.engineMaxRpm) === 0) return;
  player.inputs = {
    throttle: clamp01(f.f64(o + TELEM.throttle)),
    brake: clamp01(f.f64(o + TELEM.brake)),
    clutch: clamp01(f.f64(o + TELEM.clutch)),
    steer: Math.min(1, Math.max(-1, f.f64(o + TELEM.steering))),
  };
  player.gear = f.i32(o + TELEM.gear);
  player.rpm = f.f64(o + TELEM.rpm);
  player.speedMps = Math.hypot(
    f.f64(o + TELEM.localVel),
    f.f64(o + TELEM.localVel + 8),
    f.f64(o + TELEM.localVel + 16),
  );
  player.fuelL = f.f64(o + TELEM.fuel);
  player.fuelCapacityL = f.f64(o + TELEM.fuelCapacity);
  const energy = f.f32(o + TELEM.virtualEnergy);
  player.energyFraction = energy >= 0 && energy <= 1 ? energy : null;
  player.pitLimiter = f.u8(o + TELEM.speedLimiter) === 1;
  player.tyres = readTyres(f, o);
}

function readTyres(f: Frame, row: number): TyreSet | null {
  const corners: TyreCorner[] = [];
  for (let w = 0; w < WHEEL_COUNT; w++) {
    const wo = wheelOffset(row, w);
    if (isAbsentWheel(f, wo)) return null;
    // Wheels run front-left, front-right, rear-left, rear-right. The three temperatures go
    // left to right across the tread, so on a left wheel the right edge is the inner one.
    const left = f.f64(wo + WHEEL.temps) - KELVIN;
    const middle = f.f64(wo + WHEEL.temps + 8) - KELVIN;
    const right = f.f64(wo + WHEEL.temps + 16) - KELVIN;
    const isLeftWheel = w % 2 === 0;
    corners.push({
      temps: isLeftWheel
        ? { inner: right, middle, outer: left }
        : { inner: left, middle, outer: right },
      pressureKpa: f.f64(wo + WHEEL.pressure),
      // The sim reports remaining tread (1 = new); SimState wants wear (0 = new).
      wear: clamp01(1 - f.f64(wo + WHEEL.wear)),
    });
  }
  const [fl, fr, rl, rr] = corners;
  return fl && fr && rl && rr ? { fl, fr, rl, rr } : null;
}
