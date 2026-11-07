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
  /** iRacing WeekendOptions IncidentLimit; null = unlimited or unknown. */
  incidentLimit: number | null;
  /** Sim time of day, seconds after midnight. */
  timeOfDayS: number | null;
  /** The sim's own session name, e.g. iRacing "Lone Qualify" / "Offline Testing", LMU "PRACTICE1". */
  typeName: string | null;
  /** Rubbered-in state as the sim words it (iRacing SessionTrackRubberState, e.g. "moderate usage"). */
  trackUsage: string | null;
  /**
   * Where each of the track's official sectors starts, as a lap fraction: sorted, the first is 0,
   * every value in [0, 1). Null when the sim gives no sector data (or it has not been learned yet).
   */
  sectorStartPcts: number[] | null;
}

export interface Conditions {
  airTempC: number | null;
  trackTempC: number | null;
  /** Track surface wetness, 0 (dry) .. 1 (soaked). */
  wetness: number | null;
  /** 0..1. */
  precipitation: number | null;
  /** 0..1. */
  humidity: number | null;
  /** 0..1. */
  fogLevel: number | null;
  windSpeedMps: number | null;
  /** Direction the wind comes from, radians clockwise from north. */
  windDirRad: number | null;
  /** Race control declared the session wet (iRacing WeatherDeclaredWet). */
  declaredWet: boolean | null;
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
  /** Disqualified (iRacing irsdk_disqualify 0x20000). */
  disqualified: boolean;
  /** Meatball / repair required (iRacing irsdk_repair 0x100000). */
  repair: boolean;
  /** Furled black, a warning (iRacing irsdk_furled 0x80000). */
  furled: boolean;
}

/**
 * Where a car is on the track (iRacing irsdk_TrkLoc: -1 NotInWorld, 0 OffTrack, 1 InPitStall,
 * 2 AproachingPits, 3 OnTrack).
 */
export type TrackSurface = "notInWorld" | "offTrack" | "inPitStall" | "approachingPits" | "onTrack";

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
  /** iRacing DriverInfo TeamName; LMU null unless reliably parsed. */
  teamName: string | null;
  /** LMU per-vehicle world position; iRacing null. */
  worldPos: Vec3 | null;
  /** LMU per-vehicle fuel fraction 0..1; iRacing null. */
  fuelFraction: number | null;
  /** Flags shown to this car (iRacing CarIdxSessionFlags); null when the sim gives none. */
  flags: Flags | null;
  /** Push-to-pass activations left (iRacing CarIdxP2P_Count); null when the car has none. */
  p2pCount: number | null;
  /** Push-to-pass active now (iRacing CarIdxP2P_Status). */
  p2pActive: boolean | null;
  /** iRacing CarIdxTrackSurface mapped; LMU null unless derivable. Drives the yellow row. */
  trackSurface: TrackSurface | null;
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

/** One live lap-delta channel of the sim. */
export interface LapDeltaChannel {
  /** Seconds against the reference lap; negative = ahead (faster). */
  s: number;
  /** The sim says the value is valid right now (iRacing `*_OK`). */
  ok: boolean;
  /** Rate of change of the delta in s/s (iRacing `*_DD`); null when not provided. */
  rate: number | null;
}

/** The sim's own live deltas; each null when the sim does not provide that channel. */
export interface PlayerLapDeltas {
  /** Against the player's all-time best lap (iRacing LapDeltaToBestLap). */
  best: LapDeltaChannel | null;
  /** Against the session best lap (iRacing LapDeltaToSessionBestLap). */
  sessionBest: LapDeltaChannel | null;
  /** Against the player's last lap (iRacing LapDeltaToSessionLastlLap; the sim spells it so). */
  sessionLast: LapDeltaChannel | null;
}

/** The player's own lap timing. */
export interface PlayerLap {
  /** Time into the current lap (iRacing LapCurrentLapTime; LMU scoring timeIntoLap). */
  currentLapS: number | null;
  /** iRacing LapLastLapTime; LMU scoring lastLapTime. Null until set (sim reports <= 0). */
  lastLapS: number | null;
  /** iRacing LapBestLapTime; LMU scoring bestLapTime. Null until set. */
  bestLapS: number | null;
  /** Null for sims without live delta channels (LMU). */
  delta: PlayerLapDeltas | null;
}

/** Shift-light points of the player's car, rpm (iRacing SLI data). */
export interface ShiftLightRpm {
  /** First light comes on. */
  firstRpm: number;
  /** Shift point: every light in the shift colour. */
  shiftRpm: number;
  /** Last light comes on. */
  lastRpm: number;
  /** Lights blink from here; null when the car has no blink point. */
  blinkRpm: number | null;
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
  /** Heading in radians, clockwise from north (iRacing YawNorth); null when not provided. */
  yawRad: number | null;
  /** Velocity in the car frame (iRacing VelocityX/Y/Z); null when not provided. */
  velocityMps: Vec3 | null;
  /** iRacing DriverPitTrkPct (lap distance of the player's pit stall); LMU null. */
  pitStallLapDistPct: number | null;
  /** Front share of the brake force, 0..1. */
  brakeBias: number | null;
  /** Null when the sim gives no lap timing or the player is not driving. */
  lap: PlayerLap | null;
  /** ABS is cutting brake pressure now (iRacing BrakeABSactive). */
  absActive: boolean | null;
  /** iRacing PlayerTrackSurface mapped. */
  trackSurface: TrackSurface | null;
  /** iRacing IsOnTrack (in the car, on track, not in the garage/replay). */
  isOnTrack: boolean | null;
  /** iRacing SLI rpm points; null when the car has none (all zero) or the sim gives none. */
  shiftLights: ShiftLightRpm | null;
  /** Redline / engine max rpm (iRacing DriverCarRedLine; LMU telemetry rpmLimit). */
  redlineRpm: number | null;
  /** Steering wheel lock, radians each side (iRacing SteeringWheelAngleMax). */
  steerMaxRad: number | null;
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
    disqualified: false,
    repair: false,
    furled: false,
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
    teamName: null,
    worldPos: null,
    fuelFraction: null,
    flags: null,
    p2pCount: null,
    p2pActive: null,
    trackSurface: null,
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
      incidentLimit: null,
      timeOfDayS: null,
      typeName: null,
      trackUsage: null,
      sectorStartPcts: null,
    },
    conditions: {
      airTempC: null,
      trackTempC: null,
      wetness: null,
      precipitation: null,
      humidity: null,
      fogLevel: null,
      windSpeedMps: null,
      windDirRad: null,
      declaredWet: null,
    },
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
      pitStallLapDistPct: null,
      brakeBias: null,
      lap: null,
      absActive: null,
      trackSurface: null,
      isOnTrack: null,
      shiftLights: null,
      redlineRpm: null,
      steerMaxRad: null,
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
