/**
 * The normalised, sim-agnostic snapshot every adapter produces and every calculator and overlay
 * consumes. It is plain, JSON-serialisable data (no classes, no Dates, no Maps).
 *
 * Conventions
 * - SI units: metres, seconds, m/s, litres, kPa, degrees Celsius, radians. km/h, mph, gallons and
 *   psi exist only in display code.
 * - Unknown is `null`, never 0. A value is `null` when the sim does not provide it or the adapter
 *   does not decode it yet.
 * - Fractions are 0..1 (throttle, brake, wetness, energy, lapDistPct).
 *
 * Evolving the shape
 * - Adding a nullable field (with a `null` default in {@link emptySimState}) or a new member to a
 *   string union is backward compatible and keeps the version. Version 1 is unreleased, so its
 *   shape may still change without a bump until the first adapter ships.
 * - Renaming, removing, retyping or changing the meaning or unit of a field bumps
 *   {@link SIM_STATE_VERSION}. Update `emptySimState`, `isSimState` and every consumer in the same
 *   change; recorded or persisted snapshots carry `version` so old data can be recognised.
 */
export const SIM_STATE_VERSION = 1;

export type SimSource = "iracing" | "lmu" | "replay" | "mock";

/** The sim a state came from, kept even when `source` is "replay" or "mock". */
export type SimName = "iracing" | "lmu";

export type SessionType = "practice" | "qualifying" | "race" | "warmup" | "other";

/** Where the session is in its life; adapters map each sim's own states onto these. */
export type SessionPhase =
  "garage" | "gridding" | "formation" | "racing" | "checkered" | "cooldown";

/** How the session ends: after a number of laps, after a time, or whichever comes first. */
export type SessionTiming = "laps" | "time" | "laps-or-time";

export interface SessionInfo {
  type: SessionType | null;
  phase: SessionPhase | null;
  timing: SessionTiming | null;
  /** Seconds left; null when the session is lap-limited or unknown. */
  timeRemainingS: number | null;
  /** Total session length in seconds, when time-limited. */
  timeTotalS: number | null;
  lapsRemaining: number | null;
  lapsTotal: number | null;
  trackName: string | null;
  /** Layout of the track, e.g. "Full Course"; null when the sim does not name one. */
  trackConfig: string | null;
  trackLengthM: number | null;
  pitSpeedLimitMps: number | null;
}

export interface Conditions {
  airTempC: number | null;
  trackTempC: number | null;
  /** Track surface wetness, 0 (dry) .. 1 (soaked). */
  wetness: number | null;
}

/** Flags currently shown to the player. All false when nothing is shown. */
export interface Flags {
  green: boolean;
  yellow: boolean;
  fullCourseYellow: boolean;
  red: boolean;
  blue: boolean;
  white: boolean;
  checkered: boolean;
  black: boolean;
}

export interface Car {
  carIdx: number;
  driverName: string | null;
  carName: string | null;
  classId: string | null;
  className: string | null;
  /** CSS hex colour such as "#ffda59". */
  classColour: string | null;
  carNumber: string | null;
  /** Overall position, 1 = leader. */
  position: number | null;
  classPosition: number | null;
  /** Laps completed (0 on the out lap before the first S/F crossing). */
  lapsCompleted: number | null;
  /** Lap being driven: lapsCompleted + 1 once running. */
  lapInProgress: number | null;
  /** Fraction of the lap completed, 0..1. */
  lapDistPct: number | null;
  onPitRoad: boolean | null;
  inPitStall: boolean | null;
  isOnTrack: boolean | null;
  lastLapS: number | null;
  bestLapS: number | null;
  /**
   * Sim-provided time in seconds the car needs from the S/F line to reach where it is now
   * (iRacing CarIdxEstTime); with the lap time it gives gaps on track.
   */
  estTimeS: number | null;
  isPaceCar: boolean | null;
  isPlayer: boolean | null;
  iRating: number | null;
  /** License as shown by the sim, e.g. "A 3.41". */
  license: string | null;
  connected: boolean;
}

export interface PlayerInputs {
  throttle: number | null;
  brake: number | null;
  clutch: number | null;
  /** Steering wheel position -1..1 of full lock; positive is to the right. */
  steer: number | null;
}

/** Tyre temperature across the tread, degrees Celsius; "inner" is the car-centre side. */
export interface TyreTemps {
  inner: number | null;
  middle: number | null;
  outer: number | null;
}

export interface TyreCorner {
  temps: TyreTemps;
  /** Hot pressure in kPa. */
  pressureKpa: number | null;
  /** 0 = new, 1 = fully worn. */
  wear: number | null;
}

export interface TyreSet {
  fl: TyreCorner;
  fr: TyreCorner;
  rl: TyreCorner;
  rr: TyreCorner;
}

/** Spotter state: which sides have a car alongside. */
export type CarLeftRight = "clear" | "left" | "right" | "both" | "twoLeft" | "twoRight";

/** A point in the sim's world frame, metres. LMU: y is up, the ground plane is x/z. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Player {
  inputs: PlayerInputs;
  /** -1 reverse, 0 neutral, 1..n forward. */
  gear: number | null;
  speedMps: number | null;
  rpm: number | null;
  fuelL: number | null;
  fuelCapacityL: number | null;
  /** LMU virtual energy, 0..1. */
  energyFraction: number | null;
  tyres: TyreSet | null;
  incidentCount: number | null;
  pitLimiter: boolean | null;
  carLeftRight: CarLeftRight | null;
  /** Position in the world frame; LMU only (iRacing gives none). Feeds track outlines. */
  worldPos: Vec3 | null;
  /** Heading in radians as the sim reports it (iRacing Yaw); null when not provided. */
  yawRad: number | null;
  /** Velocity in the car frame (iRacing VelocityX/Y/Z); null when not provided. */
  velocityMps: Vec3 | null;
}

export interface SimState {
  version: typeof SIM_STATE_VERSION;
  source: SimSource;
  /** The sim behind `source`; null for the mock and before a sim is known. */
  sim: SimName | null;
  connected: boolean;
  /** Sim session time in seconds; null when unknown. */
  tickTimeS: number | null;
  session: SessionInfo;
  conditions: Conditions;
  flags: Flags | null;
  playerCarIdx: number | null;
  /** Car the camera is on (equals playerCarIdx unless spectating). */
  focusCarIdx: number | null;
  cars: Car[];
  player: Player;
}

export function emptyFlags(): Flags {
  return {
    green: false,
    yellow: false,
    fullCourseYellow: false,
    red: false,
    blue: false,
    white: false,
    checkered: false,
    black: false,
  };
}

export function emptyCar(carIdx: number): Car {
  return {
    carIdx,
    driverName: null,
    carName: null,
    classId: null,
    className: null,
    classColour: null,
    carNumber: null,
    position: null,
    classPosition: null,
    lapsCompleted: null,
    lapInProgress: null,
    lapDistPct: null,
    onPitRoad: null,
    inPitStall: null,
    isOnTrack: null,
    lastLapS: null,
    bestLapS: null,
    estTimeS: null,
    isPaceCar: null,
    isPlayer: null,
    iRating: null,
    license: null,
    connected: false,
  };
}

export function emptySimState(source: SimSource = "mock"): SimState {
  return {
    version: SIM_STATE_VERSION,
    source,
    sim: null,
    connected: false,
    tickTimeS: null,
    session: {
      type: null,
      phase: null,
      timing: null,
      timeRemainingS: null,
      timeTotalS: null,
      lapsRemaining: null,
      lapsTotal: null,
      trackName: null,
      trackConfig: null,
      trackLengthM: null,
      pitSpeedLimitMps: null,
    },
    conditions: { airTempC: null, trackTempC: null, wetness: null },
    flags: null,
    playerCarIdx: null,
    focusCarIdx: null,
    cars: [],
    player: {
      inputs: { throttle: null, brake: null, clutch: null, steer: null },
      gear: null,
      speedMps: null,
      rpm: null,
      fuelL: null,
      fuelCapacityL: null,
      energyFraction: null,
      tyres: null,
      incidentCount: null,
      pitLimiter: null,
      carLeftRight: null,
      worldPos: null,
      yawRad: null,
      velocityMps: null,
    },
  };
}

const SOURCES: readonly string[] = ["iracing", "lmu", "replay", "mock"];

/**
 * Structural check for data that crossed a boundary (IPC, a file, a message). It verifies the
 * version, the enum members, and that every nested container exists; it does not re-validate
 * every number.
 */
export function isSimState(value: unknown): value is SimState {
  if (!isObject(value)) return false;
  if (value["version"] !== SIM_STATE_VERSION) return false;
  if (typeof value["source"] !== "string" || !SOURCES.includes(value["source"])) return false;
  if (typeof value["connected"] !== "boolean") return false;
  // `sim` was added later: absent in older data, which is fine.
  const sim = value["sim"];
  if (sim !== undefined && sim !== null && sim !== "iracing" && sim !== "lmu") return false;
  if (!isNullableNumber(value["tickTimeS"]) || !isNullableNumber(value["playerCarIdx"])) {
    return false;
  }
  if (!isObject(value["session"]) || !isObject(value["conditions"])) return false;
  if (value["flags"] !== null && !isObject(value["flags"])) return false;
  if (!Array.isArray(value["cars"]) || !value["cars"].every(isCar)) return false;
  const player = value["player"];
  return isObject(player) && isObject(player["inputs"]);
}

function isCar(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value["carIdx"] === "number" &&
    typeof value["connected"] === "boolean"
  );
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
