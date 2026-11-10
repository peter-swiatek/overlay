import {
  emptyCar,
  emptySimState,
  lmuClassColour,
  type Car,
  type Flags,
  type PlayerLap,
  type SessionInfo,
  type SessionPhase,
  type SessionTiming,
  type SessionType,
  type SimState,
  type TrackSurface,
  type TyreCorner,
  type TyreSet,
  type Vec3,
} from "../../model";
import {
  COMPOUND_KIND_NAMES,
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
  TYRE_COUNT,
} from "./layout";
import { decodeSimText } from "../../sim-text";
import { applyRestResponse, emptyRestSnapshot, type LmuRestSnapshot } from "./rest";
import { LmuSectorLearner } from "./sectors";

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
const SECONDS_PER_DAY = 86_400;
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
  /** NUL-terminated text, UTF-8 when valid, else Windows-1252. */
  text(o: number, length: number): string {
    return decodeSimText(this.bytes.subarray(o, o + length));
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
  private readonly sectors = new LmuSectorLearner();

  constructor(options: LmuDecoderOptions = {}) {
    this.validated = options.validatedGameVersions ?? LMU_VALIDATED_GAME_VERSIONS;
  }

  /** Feeds a recorded REST response (`/rest/watch/standings` or `/rest/watch/sessionInfo`). */
  observeRest(response: { path: string; status?: number; body: unknown }): void {
    this.rest = applyRestResponse(this.rest, response);
  }

  private lastSessionCode: number | null = null;
  private lastEventTime = -Infinity;

  /** REST data belongs to one session: forget it when the session changes or the clock restarts. */
  private dropStaleRest(sessionCode: number, eventTime: number): void {
    const changed =
      (this.lastSessionCode !== null && sessionCode !== this.lastSessionCode) ||
      eventTime < this.lastEventTime - 1;
    if (changed) this.rest = emptyRestSnapshot();
    this.lastSessionCode = sessionCode;
    this.lastEventTime = eventTime;
  }

  decode(buffer: Uint8Array): LmuDecodeResult {
    if (buffer.length < LMU_USED_BYTES) {
      return failed(`LMU_Data is ${buffer.length} bytes, expected at least ${LMU_USED_BYTES}`);
    }
    const f = new Frame(buffer);
    const warnings: string[] = [];
    const problem = validateFrame(f);
    if (problem) return failed(problem);

    const version = f.i32(HEADER.appBuild);
    if (!this.validated.includes(version)) {
      warnings.push(`game build ${version} was not validated against this layout`);
    }
    const active = f.u8(TELEMETRY_BASE + TELEMETRY.carsWithTelemetry);
    const count = f.i32(SCORING_BASE + SESSION.numberOfVehicles);
    // The two sections are written separately; a frame that disagrees was copied mid-update.
    if (active !== count) return failed(`scoring has ${count} vehicles, telemetry ${active}`);
    this.dropStaleRest(
      f.i32(SCORING_BASE + SESSION.sessionCode),
      f.f64(SCORING_BASE + SESSION.currentEventTime),
    );

    const trackLengthM = f.f64(SCORING_BASE + SESSION.lapDistance);
    const cars = readCars(f, count, trackLengthM, this.rest);
    markClassPositions(cars);
    const playerRow = findPlayerRow(f, count);
    const playerId = playerRow === null ? null : f.i32(playerRow + VEHICLE.slotId);
    const state = emptySimState("lmu");
    state.connected = true;
    state.sim = "lmu";
    state.tickTimeS = f.f64(SCORING_BASE + SESSION.currentEventTime);
    state.cars = cars;
    state.playerCarIdx = playerId;
    state.focusCarIdx = playerId;
    state.session = readSession(f, trackLengthM, count, this.rest);
    state.session.sectorStartPcts = this.sectors.observe(
      state.session.trackName === null ? null : `${state.session.trackName}|${trackLengthM}`,
      playerRow === null ? -1 : f.i8(playerRow + VEHICLE.sector),
      cars.find((c) => c.isPlayer)?.lapDistPct ?? null,
    );
    state.conditions = {
      ...state.conditions,
      airTempC: f.f64(SCORING_BASE + SESSION.ambientTemp),
      trackTempC: f.f64(SCORING_BASE + SESSION.trackTemp),
      wetness: clamp01(f.f64(SCORING_BASE + SESSION.averagePathWetness)),
    };
    state.flags = playerRow === null ? null : readFlags(f, playerRow);
    state.player.worldPos = playerRow === null ? null : readWorldPos(f, playerRow);
    state.player.yawRad = playerRow === null ? null : readYaw(f, playerRow);
    if (playerRow !== null) {
      const inCar = f.u8(TELEMETRY_BASE + TELEMETRY.playerInCar) === 1;
      const live = f.u8(SCORING_BASE + SESSION.inRealtime) === 1;
      const stalled = cars.find((c) => c.isPlayer)?.inPitStall === true;
      state.player.lap = inCar ? readPlayerLap(f, playerRow) : null;
      state.player.trackSurface = playerSurface(inCar, live, stalled);
      state.player.isOnTrack = inCar && live;
    }

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
  const count = f.i32(s + SESSION.numberOfVehicles);
  const first =
    outside(W.gameVersion, f.i32(HEADER.appBuild)) ??
    outside(W.vehicles, count) ??
    outside(W.vehicles, f.u8(TELEMETRY_BASE + TELEMETRY.carsWithTelemetry)) ??
    outside(W.et, f.f64(s + SESSION.currentEventTime)) ??
    outside(W.ambient, f.f64(s + SESSION.ambientTemp)) ??
    outside(W.trackTemp, f.f64(s + SESSION.trackTemp)) ??
    outside(W.wetness, f.f64(s + SESSION.averagePathWetness));
  if (first) return first;
  const trackLength = f.f64(s + SESSION.lapDistance);
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
    outside(W.laps, f.i16(o + VEHICLE.lapsCompleted)) ??
    outside(W.place, f.u8(o + VEHICLE.position)) ??
    outside(W.pitState, f.u8(o + VEHICLE.pitState)) ??
    outside(
      { name: "lap distance m", lo: -slack, hi: trackLength + slack },
      f.f64(o + VEHICLE.lapDistance),
    )
  );
}

/**
 * The player's telemetry row. A player who is not driving (menu, garage screen) has an all-zero
 * row, which is "no data", not a wrong layout.
 */
function validatePlayerTelemetry(f: Frame): string | null {
  const t = TELEMETRY_BASE;
  if (f.u8(t + TELEMETRY.playerInCar) === 0) return null;
  const idx = f.u8(t + TELEMETRY.playerRowIndex);
  if (idx >= LMU_MAX_VEHICLES) return `player vehicle index ${idx} out of range`;
  const o = telemetryRowOffset(idx);
  if (f.f64(o + TELEM.rpmLimit) === 0) return null;
  const speed = Math.hypot(
    f.f64(o + TELEM.velocity),
    f.f64(o + TELEM.velocity + 8),
    f.f64(o + TELEM.velocity + 16),
  );
  const bad =
    outside(W.rpm, f.f64(o + TELEM.engineRpm)) ??
    outside(W.gear, f.i32(o + TELEM.gear)) ??
    outside(W.pedal, f.f64(o + TELEM.throttleInput)) ??
    outside(W.pedal, f.f64(o + TELEM.brakeInput)) ??
    outside(W.pedal, f.f64(o + TELEM.clutchInput)) ??
    outside(W.steer, f.f64(o + TELEM.steeringInput)) ??
    outside(W.fuel, f.f64(o + TELEM.fuelLitres)) ??
    outside(W.fuel, f.f64(o + TELEM.tankCapacityLitres)) ??
    outside(W.speed, speed);
  if (bad) return `player telemetry: ${bad}`;
  const capacity = f.f64(o + TELEM.tankCapacityLitres);
  if (f.f64(o + TELEM.fuelLitres) > capacity * 1.01 + 0.5)
    return "player telemetry: fuel above tank size";
  for (let w = 0; w < TYRE_COUNT; w++) {
    const wo = wheelOffset(o, w);
    if (isAbsentWheel(f, wo)) continue;
    const wheelBad =
      outside(W.tyreK, f.f64(wo + WHEEL.surfaceTempK)) ??
      outside(W.tyreK, f.f64(wo + WHEEL.surfaceTempK + 8)) ??
      outside(W.tyreK, f.f64(wo + WHEEL.surfaceTempK + 16)) ??
      outside(W.pressure, f.f64(wo + WHEEL.pressureKpa)) ??
      outside(W.wear, f.f64(wo + WHEEL.treadRemaining));
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
  return row + TELEM.tyresOffset + wheel * TELEM.tyreStride;
}

function isAbsentWheel(f: Frame, wo: number): boolean {
  return f.f64(wo + WHEEL.surfaceTempK) === 0 && f.f64(wo + WHEEL.surfaceTempK + 8) === 0;
}

/**
 * Only code 1 (REST session "PRACTICE1") is observed. Other codes fall back to the REST session
 * name when we have it, otherwise stay unknown.
 * TODO: add numeric codes once a qualifying and a race recording exist.
 */
export function sessionTypeOf(code: number, restSession: string | null): SessionType | null {
  if (code === 1) return "practice";
  if (restSession === null) return null;
  if (restSession.startsWith("PRACTICE")) return "practice";
  if (restSession.startsWith("QUALIFY")) return "qualifying";
  if (restSession.startsWith("WARMUP")) return "warmup";
  if (restSession.startsWith("RACE")) return "race";
  return null;
}

/**
 * Observed in the recording: 0 before the session is running (garage, loading) and 5 while it
 * runs. Every other code stays unknown until a race recording shows what it means.
 */
export function phaseOf(gamePhase: number): SessionPhase | null {
  if (gamePhase === 0) return "garage";
  if (gamePhase === 5) return "racing";
  return null;
}

function readSession(
  f: Frame,
  trackLengthM: number,
  count: number,
  rest: LmuRestSnapshot,
): SessionInfo {
  const s = SCORING_BASE;
  const maxLaps = f.i32(s + SESSION.maximumLaps);
  const endEt = f.f64(s + SESSION.endEventTime);
  const et = f.f64(s + SESSION.currentEventTime);
  const lapLimited = maxLaps > 0 && maxLaps < MAX_REAL_LAPS;
  const timeLimited = endEt > 0 && endEt < MAX_REAL_END_ET_S;
  let timing: SessionTiming | null = null;
  if (lapLimited && timeLimited) timing = "laps-or-time";
  else if (lapLimited) timing = "laps";
  else if (timeLimited) timing = "time";
  const leaderLaps = leaderLapsCompleted(f, count);
  const track = f.text(s + SESSION.trackName.offset, SESSION.trackName.length);
  return {
    type: sessionTypeOf(f.i32(s + SESSION.sessionCode), rest.session?.session ?? null),
    phase: phaseOf(f.u8(s + SESSION.gamePhase)),
    timing,
    timeRemainingS: timeLimited ? Math.max(0, endEt - et) : null,
    timeTotalS: timeLimited ? (rest.session?.maxTimeS ?? endEt) : null,
    lapsRemaining: lapLimited && leaderLaps !== null ? Math.max(0, maxLaps - leaderLaps) : null,
    lapsTotal: lapLimited ? maxLaps : null,
    trackName: track.length > 0 ? track : null,
    // Neither the scoring block nor REST names the layout.
    trackConfig: null,
    trackLengthM: trackLengthM > 0 ? trackLengthM : null,
    // No pit speed limit exists in the buffer or the recorded REST bodies (see layout.ts).
    pitSpeedLimitMps: null,
    incidentLimit: null,
    incidentPenaltyLimit: null,
    teamRacing: null,
    timeOfDayS: timeOfDay(f.f32(s + SESSION.timeOfDay)),
    typeName: rest.session?.session ?? null,
    trackUsage: null,
    // Learned from the player's sector changes by LmuSectorLearner (decode fills it in).
    sectorStartPcts: null,
  };
}

/**
 * The player's lap timing from the scoring row: time into the lap, last and best lap (the sim
 * writes -1 or 0 until a lap is set). LMU has no live delta channels, so `delta` stays null.
 */
function readPlayerLap(f: Frame, row: number): PlayerLap {
  const into = f.f64(row + VEHICLE.timeIntoLap);
  return {
    currentLapS: Number.isFinite(into) && into >= 0 ? into : null,
    lastLapS: positiveOrNull(f.f64(row + VEHICLE.lastLapTime)),
    bestLapS: positiveOrNull(f.f64(row + VEHICLE.bestLapTime)),
    delta: null,
  };
}

/**
 * In the stall, else on track while in real time and in the car, else not in the world. Never
 * `offTrack` or `approachingPits`: nothing in the buffer proves them.
 */
function playerSurface(inCar: boolean, live: boolean, inStall: boolean): TrackSurface {
  if (inStall) return "inPitStall";
  return inCar && live ? "onTrack" : "notInWorld";
}

/** Seconds after midnight; the sim keeps counting past 24 h in long sessions. */
function timeOfDay(seconds: number): number | null {
  return Number.isFinite(seconds) && seconds >= 0 ? seconds % SECONDS_PER_DAY : null;
}

/**
 * Observed: green while the session runs (phase 5), blue flag on the player's car, and yellow as
 * a plain 0/1. Full-course yellow, red, checkered, white and black have no observed trigger yet,
 * so they stay false. TODO: derive them from a race recording.
 */
function readFlags(f: Frame, playerRow: number): Flags {
  const running = f.u8(SCORING_BASE + SESSION.gamePhase) === 5;
  const yellow = f.u8(playerRow + VEHICLE.underYellow) === 1;
  return {
    green: running && !yellow,
    yellow,
    fullCourseYellow: false,
    red: false,
    blue: f.u8(playerRow + VEHICLE.flag) === 6,
    white: false,
    checkered: false,
    black: false,
    disqualified: false,
    repair: false,
    furled: false,
  };
}

/** Laps completed by the car in first place; the race ends for everybody when it finishes. */
function leaderLapsCompleted(f: Frame, count: number): number | null {
  for (let i = 0; i < count; i++) {
    const o = VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE;
    if (f.u8(o + VEHICLE.position) === 1) return f.i16(o + VEHICLE.lapsCompleted);
  }
  return null;
}

function findPlayerRow(f: Frame, count: number): number | null {
  for (let i = 0; i < count; i++) {
    const o = VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE;
    if (f.u8(o + VEHICLE.player) === 1) return o;
  }
  return null;
}

function findTelemetryRow(f: Frame, id: number): number | null {
  const t = TELEMETRY_BASE;
  if (f.u8(t + TELEMETRY.playerInCar) === 0) return null;
  const active = Math.min(f.u8(t + TELEMETRY.carsWithTelemetry), LMU_MAX_VEHICLES);
  for (let i = 0; i < active; i++) {
    const o = telemetryRowOffset(i);
    if (f.i32(o + TELEM.slotId) === id) return o;
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
  const id = f.i32(o + VEHICLE.slotId);
  const car = emptyCar(id);
  const extra = rest.cars.get(id);
  const vehicleName = f.text(o + VEHICLE.vehicleName.offset, VEHICLE.vehicleName.length);
  const klass = f.text(o + VEHICLE.carClass.offset, VEHICLE.carClass.length);
  const className = klass.length > 0 ? klass : (extra?.carClass ?? null);
  const laps = f.i16(o + VEHICLE.lapsCompleted);
  const inPits = f.u8(o + VEHICLE.pitting) === 1;
  const control = f.i8(o + VEHICLE.inControl);
  const controlKnown = control === 0 || control === 1;
  const timeIntoLap = f.f64(o + VEHICLE.timeIntoLap);
  const driver = f.text(o + VEHICLE.driverName.offset, VEHICLE.driverName.length);
  car.driverName = driver.length > 0 ? driver : null;
  car.carName = vehicleName.length > 0 ? vehicleName : null;
  car.classId = className;
  car.className = className;
  car.classColour = lmuClassColour(className);
  car.carNumber = extra?.carNumber ?? numberFromVehicleName(vehicleName);
  car.teamName = extra?.teamName ?? teamFromVehicleName(vehicleName);
  car.worldPos = readWorldPos(f, o);
  car.fuelFraction = f.u8(o + VEHICLE.fuelFraction) / 255;
  car.position = f.u8(o + VEHICLE.position) || null;
  car.lapsCompleted = laps;
  car.lapInProgress = laps + 1;
  car.lapDistPct = lapPct(f.f64(o + VEHICLE.lapDistance), trackLengthM);
  car.onPitRoad = inPits;
  car.inPitStall = inPitStall(f, o, inPits, extra?.pitState ?? null);
  // Like iRacing, "on track" means in the world (a car in the pits is), so overlays and the
  // spotter can tell the pits from a car that is not there.
  car.isOnTrack = controlKnown ? true : null;
  car.lastLapS = positiveOrNull(f.f64(o + VEHICLE.lastLapTime));
  car.bestLapS = positiveOrNull(f.f64(o + VEHICLE.bestLapTime));
  car.estTimeS = timeIntoLap >= 0 && Number.isFinite(timeIntoLap) ? timeIntoLap : null;
  car.isPlayer = f.u8(o + VEHICLE.player) === 1;
  car.connected = controlKnown;
  car.flags = readFlags(f, o);
  return car;
}

/**
 * A car counts as in its stall when the session runs, it is on pit road and its garage-stall flag
 * is set (a car parked in the garage before the session is not "in its stall" for overlays). Else
 * REST says "not in stall" for the observed states NONE and EXITING; anything else is unknown, because the pit
 * state codes are shifted against what we expected (only 0 = none and 5 = exiting are observed).
 * TODO: confirm the stopped code from a recording with a pit stop.
 */
function inPitStall(
  f: Frame,
  o: number,
  onPitRoad: boolean,
  restPitState: string | null,
): boolean | null {
  const live = f.u8(SCORING_BASE + SESSION.gamePhase) === 5;
  if (live && onPitRoad && f.u8(o + VEHICLE.inGarageStall) === 1) return true;
  // Only NONE and EXITING were seen; a stopped-in-stall name is unobserved.
  // TODO: accept it once a recording with a pit stop shows what REST calls it.
  if (restPitState === "NONE" || restPitState === "EXITING") return false;
  return null;
}

export function numberFromVehicleName(name: string): string | null {
  return /#(\w+)/.exec(name)?.[1] ?? null;
}

/**
 * vehicleName is "<team> <year> #<number>:<livery tag>" for every car in the recording (4,255
 * rows, one shape), and REST fullTeamName equals the part before the year. Anything that does not
 * match that shape gives no team rather than a guess.
 */
export function teamFromVehicleName(name: string): string | null {
  const team = /^(.+?)\s+\d{4}\s+#\w+:/.exec(name)?.[1]?.trim();
  return team === undefined || team.length === 0 ? null : team;
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
  if (f.f64(o + TELEM.rpmLimit) === 0) return;
  player.inputs = {
    throttle: clamp01(f.f64(o + TELEM.throttleInput)),
    brake: clamp01(f.f64(o + TELEM.brakeInput)),
    clutch: clamp01(f.f64(o + TELEM.clutchInput)),
    steer: Math.min(1, Math.max(-1, f.f64(o + TELEM.steeringInput))),
  };
  player.gear = f.i32(o + TELEM.gear);
  player.rpm = f.f64(o + TELEM.engineRpm);
  player.speedMps = Math.hypot(
    f.f64(o + TELEM.velocity),
    f.f64(o + TELEM.velocity + 8),
    f.f64(o + TELEM.velocity + 16),
  );
  player.fuelL = f.f64(o + TELEM.fuelLitres);
  player.fuelCapacityL = f.f64(o + TELEM.tankCapacityLitres);
  const energy = f.f32(o + TELEM.veFraction);
  player.energyFraction = energy >= 0 && energy <= 1 ? energy : null;
  player.pitLimiter = f.u8(o + TELEM.pitLimiterOn) === 1;
  player.redlineRpm = positiveOrNull(f.f64(o + TELEM.rpmLimit));
  // The row holds the rear share, including live brake migration; SimState wants the front share.
  const rear = f.f64(o + TELEM.rearBrakeBias);
  player.brakeBias = rear > 0 && rear < 1 ? 1 - rear : null;
  player.tyres = readTyres(f, o);
}

/**
 * Heading of the car's nose in the SimState convention for LMU: with the ground plane x/z and north
 * taken as -z (the way rFactor 2 cars face at yaw 0), the nose direction is (-sin yaw, -cos yaw).
 * The nose is minus the third column of the orientation matrix, so yaw = atan2(m[0][2], m[2][2]).
 * Null when the matrix is not finite or the nose points (almost) straight up or down.
 */
function readYaw(f: Frame, row: number): number | null {
  const o = row + VEHICLE.orientation;
  const m02 = f.f64(o + 2 * 8);
  const m22 = f.f64(o + 8 * 8);
  if (!Number.isFinite(m02 + m22) || Math.hypot(m02, m22) < 0.5) return null;
  return Math.atan2(m02, m22);
}

function readWorldPos(f: Frame, row: number): Vec3 | null {
  const o = row + VEHICLE.worldPos;
  const pos = { x: f.f64(o), y: f.f64(o + 8), z: f.f64(o + 16) };
  return Number.isFinite(pos.x + pos.y + pos.z) ? pos : null;
}

function readTyres(f: Frame, row: number): TyreSet | null {
  const frontCompound = compound(f, row + TELEM.frontCompound.offset, TELEM.frontCompound.length);
  const rearCompound = compound(f, row + TELEM.rearCompound.offset, TELEM.rearCompound.length);
  const axles = [
    { index: f.u8(row + TELEM.frontCompoundIndex), name: frontCompound },
    { index: f.u8(row + TELEM.rearCompoundIndex), name: rearCompound },
  ] as const;
  const corners: TyreCorner[] = [];
  for (let w = 0; w < TYRE_COUNT; w++) {
    const wo = wheelOffset(row, w);
    if (isAbsentWheel(f, wo)) return null;
    // Wheels run front-left, front-right, rear-left, rear-right. The three temperatures go
    // left to right across the tread, so on a left wheel the right edge is the inner one.
    const left = f.f64(wo + WHEEL.surfaceTempK) - KELVIN;
    const middle = f.f64(wo + WHEEL.surfaceTempK + 8) - KELVIN;
    const right = f.f64(wo + WHEEL.surfaceTempK + 16) - KELVIN;
    const isLeftWheel = w % 2 === 0;
    const across = (l: number, m: number, r: number) =>
      isLeftWheel ? { inner: r, middle: m, outer: l } : { inner: l, middle: m, outer: r };
    const layer = WHEEL.innerLayerTempK;
    const layerL = kelvinToC(f.f64(wo + layer));
    const layerM = kelvinToC(f.f64(wo + layer + 8));
    const layerR = kelvinToC(f.f64(wo + layer + 16));
    corners.push({
      temps: across(left, middle, right),
      innerLayerTemps:
        layerL === null || layerM === null || layerR === null
          ? null
          : across(layerL, layerM, layerR),
      carcassTempC: kelvinToC(f.f64(wo + WHEEL.carcassTempK)),
      brakeTempC: kelvinToC(f.f64(wo + WHEEL.brakeTempK), BRAKE_K),
      pressureKpa: f.f64(wo + WHEEL.pressureKpa),
      // The sim reports remaining tread (1 = new); SimState wants wear (0 = new).
      wear: clamp01(1 - f.f64(wo + WHEEL.treadRemaining)),
      compound: wheelCompound(f, wo, w < 2 ? axles : [axles[1], axles[0]]),
    });
  }
  const [fl, fr, rl, rr] = corners;
  if (!fl || !fr || !rl || !rr) return null;
  return {
    fl,
    fr,
    rl,
    rr,
    frontCompound,
    rearCompound,
  };
}

/**
 * The name of the compound on one wheel. The wheel gives only a list position and a kind, the
 * row names the front and rear compounds: the name of the axle with the same list position (its
 * own axle first), otherwise the name of the kind.
 */
function wheelCompound(
  f: Frame,
  wo: number,
  axles: readonly { index: number; name: string | null }[],
): string | null {
  const index = f.u8(wo + WHEEL.compoundIndex);
  const axle = axles.find((a) => a.index === index);
  if (axle) return axle.name;
  return COMPOUND_KIND_NAMES[f.u8(wo + WHEEL.compoundKind)] ?? null;
}

function compound(f: Frame, o: number, length: number): string | null {
  const name = f.text(o, length).trim();
  return name === "" ? null : name;
}

/** Brake discs run far hotter than tyres; this window only rejects garbage. */
const BRAKE_K: Window = { name: "brake temp K", lo: 200, hi: 2000 };

/** Kelvin to Celsius; null for a value outside the window (zero on a car without the channel). */
function kelvinToC(k: number, w: Window = W.tyreK): number | null {
  return outside(w, k) === null ? k - KELVIN : null;
}
