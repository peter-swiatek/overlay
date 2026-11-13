import {
  emptyCar,
  emptyFlags,
  emptySimState,
  type Car,
  type CarLeftRight,
  type Flags,
  type SimState,
  type TyreCorner,
  type TyreSet,
  type Vec3,
} from "../model";

export interface MockSourceOptions {
  /** Cars on track, player included. Default 20. */
  carCount?: number;
}

const GT3 = { id: "1", name: "GT3", colour: "#ffda59", lapS: 100 };
const HYPER = { id: "2", name: "Hypercar", colour: "#ff5888", lapS: 86 };
/** Spread of iRatings (incl. a five-digit one) so the projected changes differ in size and sign. */
const MOCK_IRATINGS: readonly number[] = [2400, 3100, 1850, 10400, 2050, 1500, 2700, 1980];
const TRACK_LENGTH_M = 5000;
/** Four sectors of unequal length, so the sector bar can be previewed. */
const MOCK_SECTOR_STARTS: readonly number[] = [0, 0.27, 0.53, 0.78];
const FUEL_CAPACITY_L = 60;
const FUEL_PER_LAP_L = 2.4;
const REFUEL_BELOW_L = 4;
const RACE_LAPS = 40;
/** Period of the demo track temperature drift, seconds. */
const TRACK_TEMP_PERIOD_S = 1800;
/** Delta channels report `ok: false` for this long at the start of each lap, seconds. */
const DELTA_SETTLE_S = 2;
/** Brake pedal level above which the demo ABS cuts in. */
const ABS_BRAKE_LEVEL = 0.8;
/** Car that is periodically under a local yellow, and the car that needs repair. */
const YELLOW_CAR = 3;
const REPAIR_CAR = 7;
/**
 * The player's flags repeat every this many seconds: green at the start, a local yellow, green
 * again as it clears, a blue flag, then a full-course caution and green once more, with quiet
 * spells between so a flag panel also shows its idle look.
 */
const PLAYER_FLAG_CYCLE_S = 90;
const PLAYER_FLAG_SCRIPT: readonly (readonly [
  number,
  number,
  "green" | "yellow" | "blue" | "fullCourseYellow",
])[] = [
  [0, 5, "green"],
  [10, 25, "yellow"],
  [25, 30, "green"],
  [38, 52, "blue"],
  [60, 72, "fullCourseYellow"],
  [72, 77, "green"],
];
/**
 * A car in the player's class that starts this far (laps) ahead of the player's start and runs
 * the player's nominal lap time, so the player always has a class rival ahead with a gap that
 * moves a little lap to lap (Battle Box, Delta Bar head-to-head).
 */
const RIVAL_CAR = 1;
const RIVAL_LEAD_LAPS = 0.03;
/**
 * Lapped-car previews: a Hypercar that starts 0.85 laps up the road, so it is just behind the
 * player on track but a lap up on distance and about to lap them, and a GT3 that starts a lap
 * down. The lap-down car is "before the line" (laps unknown) until its distance turns positive,
 * about 98 s in, as a sim reports a car that has not started a lap. Both keep the leader under a
 * lap at the start, so the start grid is still recorded.
 */
const LAP_UP_CAR = 9;
const LAP_UP_LAPS = 0.85;
const LAP_DOWN_CAR = 18;
/** Car that runs wide once per lap, and the lap fraction range it is off track. */
const OFF_TRACK_CAR = 5;
const OFF_TRACK_FROM = 0.3;
const OFF_TRACK_TO = 0.34;
/** A second car that runs wide every other lap (odd laps completed), later in the lap. */
const OFF_TRACK_CAR_2 = 12;
const OFF_TRACK_2_FROM = 0.64;
const OFF_TRACK_2_TO = 0.67;
/**
 * A car that runs {@link STOP_CAR_GAP_M} ahead of the player at the player's pace and, once every
 * {@link STOP_CYCLE_S}, crawls, stops until the player is well past, and then catches back up to
 * its place, so slow and stopped cars ahead can be previewed. Seconds into each cycle:
 * [0, STOP_AT_S) running, then STOP_CRAWL_S crawling, STOP_HALT_S standing, the rest catching up.
 */
const STOP_CAR = 15;
const STOP_CAR_GAP_M = 450;
const STOP_CYCLE_S = 120;
const STOP_AT_S = 40;
const STOP_CRAWL_S = 6;
const STOP_CRAWL_MPS = 10;
const STOP_HALT_S = 12;
/** Gear bands over the player's speed (25..55 m/s): [from, to, gear]. The last band includes 55. */
const GEAR_BANDS: readonly (readonly [number, number, number])[] = [
  [25, 30, 3],
  [30, 38, 4],
  [38, 46, 5],
  [46, 55, 6],
];
/** Lap fraction at which the player starts approaching the pit lane (limiter on), and the stall. */
const PIT_APPROACH_FROM = 0.9;
const PIT_STALL_LAP_DIST_PCT = 0.95;
/** Player lap-time offsets against the nominal lap, cycling every five completed laps, seconds. */
const LAP_VARIATION_S = [0.3, -0.2, -0.5, -0.4, 0.2];
/** Nominal player lap time, seconds; the track speed profile is scaled to take exactly this. */
const NOMINAL_LAP_S = 100;
/** Corners of the demo track: [lap fraction, half width, depth as a fraction of top speed]. */
const CORNERS: readonly (readonly [number, number, number])[] = [
  [0.12, 0.04, 0.5],
  [0.4, 0.035, 0.32],
  [0.62, 0.045, 0.45],
  [0.85, 0.03, 0.22],
];
const PROFILE_BINS = 2000;
/** Longitudinal acceleration (m/s^2) at which the demo brake pedal is fully pressed. */
const BRAKE_FULL_ACCEL = 4;
/** The demo's single unclean lap (lap 3) records this many incidents from half way through. */
const UNCLEAN_LAP_INCIDENTS = 2;
/** The demo race's incident limits: the first penalty and the disqualification. */
const INCIDENT_PENALTY_LIMIT = 17;
const INCIDENT_DQ_LIMIT = 25;

/**
 * A deterministic synthetic race for UI work without a sim: about 20 cars in two classes, the
 * player (carIdx 0, a GT3 car) burning fuel and topping up when low. Advance it with `step`;
 * the same sequence of steps always gives the same states.
 */
/** A car this close (metres, along the lap) counts as alongside the player. */
const ALONGSIDE_M = 5;
/** Scripted spotter calls when no mock car is alongside, so the spotter has something to show. */
const SPOTTER_CYCLE_S = 24;
const SPOTTER_SCRIPT: readonly (readonly [number, number, CarLeftRight])[] = [
  [2, 6, "left"],
  [10, 14, "right"],
  [18, 21, "both"],
];

/**
 * The spotter call: cars within ALONGSIDE_M go left (odd index) or right (even index); with none
 * alongside, the scripted calls repeat every SPOTTER_CYCLE_S seconds.
 */
function spotterCall(cars: readonly Car[], playerPct: number, timeS: number): CarLeftRight {
  let left = 0;
  let right = 0;
  for (const car of cars) {
    if (car.isPlayer || car.lapDistPct === null) continue;
    let d = car.lapDistPct - playerPct;
    d -= Math.round(d);
    if (Math.abs(d * TRACK_LENGTH_M) >= ALONGSIDE_M) continue;
    if (car.carIdx % 2 === 1) left++;
    else right++;
  }
  if (left > 0 && right > 0) return "both";
  if (left > 0) return left > 1 ? "twoLeft" : "left";
  if (right > 0) return right > 1 ? "twoRight" : "right";
  const t = timeS % SPOTTER_CYCLE_S;
  for (const [from, to, call] of SPOTTER_SCRIPT) if (t >= from && t < to) return call;
  return "clear";
}

/** The player's flags `timeS` into the demo (see {@link PLAYER_FLAG_SCRIPT}). */
export function mockPlayerFlags(timeS: number): Flags {
  const flags = emptyFlags();
  const t = ((timeS % PLAYER_FLAG_CYCLE_S) + PLAYER_FLAG_CYCLE_S) % PLAYER_FLAG_CYCLE_S;
  for (const [from, to, flag] of PLAYER_FLAG_SCRIPT) if (t >= from && t < to) flags[flag] = true;
  return flags;
}

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
    const pose = playerPose(this.timeS, this.playerStartS);
    const distances = Array.from({ length: this.carCount }, (_, i) =>
      i === 0
        ? pose.lapIndex + pose.fraction
        : i === STOP_CAR
          ? this.stopCarDistance()
          : this.distance(i),
    );
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
    state.flags = mockPlayerFlags(this.timeS);
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
    s.incidentLimit = INCIDENT_DQ_LIMIT;
    s.incidentPenaltyLimit = INCIDENT_PENALTY_LIMIT;
    s.teamRacing = false;
    s.sectorStartPcts = [...MOCK_SECTOR_STARTS];
    state.conditions = {
      ...state.conditions,
      airTempC: 22,
      trackTempC: trackTempAt(this.timeS),
      wetness: 0,
      humidity: 0.55,
      windSpeedMps: 4.5,
      windDirRad: 1.2,
      declaredWet: false,
      precipitation: 0,
      fogLevel: 0,
    };

    const p = state.player;
    // Speed is a fixed function of lap position (the corners) scaled by this lap's pace, and the
    // lap fraction is its integral, so lap times, deltas and speed deltas agree lap to lap.
    p.speedMps = pose.speedMps;
    // Gear and rpm follow speed: rpm climbs 5000..8000 through each band, so the shift lights
    // and the blink are reached near the top of every gear; the clutch is pressed at a change.
    const { gear, fraction } = gearAt(p.speedMps);
    p.gear = gear;
    p.rpm = 5000 + 3000 * fraction;
    const brake = Math.min(1, Math.max(0, -pose.accelMps2 / BRAKE_FULL_ACCEL));
    p.inputs = {
      throttle: brake > 0 ? 0 : Math.min(1, Math.max(0, 0.55 + pose.accelMps2 / 2.5)),
      brake,
      clutch: fraction < 0.05 ? 1 : 0,
      steer: 0.4 * steerAt(pose.fraction),
    };
    p.fuelCapacityL = FUEL_CAPACITY_L;
    p.fuelL = fuelAt(playerDistance);
    const playerLaps = Math.floor(playerDistance);
    const playerFraction = playerDistance - playerLaps;
    p.incidentCount =
      playerLaps > 2 || (playerLaps === 2 && playerFraction >= 0.5) ? UNCLEAN_LAP_INCIDENTS : 0;
    // A solo race: the team total is the player's own count.
    p.teamIncidentCount = p.incidentCount;
    p.yawRad = 2 * Math.PI * playerFraction;
    // A world position, so the track tracker can build an outline of the demo track.
    p.worldPos = worldPosAt(playerFraction);
    p.pitStallLapDistPct = PIT_STALL_LAP_DIST_PCT;
    const approachingPits =
      playerFraction >= PIT_APPROACH_FROM && playerFraction < PIT_STALL_LAP_DIST_PCT;
    p.pitLimiter = approachingPits;
    p.lap = playerLap(pose);
    p.absActive = (p.inputs.brake ?? 0) > ABS_BRAKE_LEVEL;
    // cars[0] itself stays on track and off pit road, so fuel and standings see no stop.
    p.trackSurface = approachingPits ? "approachingPits" : "onTrack";
    p.isOnTrack = true;
    p.carLeftRight = spotterCall(state.cars, playerFraction, this.timeS);
    p.shiftLights = { firstRpm: 5200, shiftRpm: 7600, lastRpm: 7400, blinkRpm: 7800 };
    p.redlineRpm = 8000;
    p.steerMaxRad = 7.85;
    p.tyres = mockTyres(playerDistance, brake);
    return state;
  }

  /** How far into its first lap the player starts, in nominal seconds. */
  private get playerStartS(): number {
    return this.carCount * 0.012 * NOMINAL_LAP_S;
  }

  /** The player's distance in laps at session time `timeS`. */
  private playerDistanceAt(timeS: number): number {
    const pose = playerPose(timeS, this.playerStartS);
    return pose.lapIndex + pose.fraction;
  }

  /** Distance in laps of {@link STOP_CAR}: a gap to the player that it loses and wins back. */
  private stopCarDistance(): number {
    const t = this.timeS;
    const into = ((t % STOP_CYCLE_S) + STOP_CYCLE_S) % STOP_CYCLE_S;
    const stopS = t - into + STOP_AT_S;
    const haltEndS = stopS + STOP_CRAWL_S + STOP_HALT_S;
    // The player's progress since the car began to slow, metres.
    const playerSince = (until: number) =>
      (this.playerDistanceAt(until) - this.playerDistanceAt(stopS)) * TRACK_LENGTH_M;
    let gapM = STOP_CAR_GAP_M;
    if (t >= stopS && t < haltEndS) {
      const crawled = STOP_CRAWL_MPS * Math.min(t - stopS, STOP_CRAWL_S);
      gapM = STOP_CAR_GAP_M + crawled - playerSince(t);
    } else if (t >= haltEndS) {
      const endGapM = STOP_CAR_GAP_M + STOP_CRAWL_MPS * STOP_CRAWL_S - playerSince(haltEndS);
      const u = (t - haltEndS) / (STOP_CYCLE_S - STOP_AT_S - STOP_CRAWL_S - STOP_HALT_S);
      const eased = u * u * (3 - 2 * u);
      gapM = endGapM + (STOP_CAR_GAP_M - endGapM) * eased;
    }
    return this.playerDistanceAt(t) + gapM / TRACK_LENGTH_M;
  }

  private carFlags(index: number): ReturnType<typeof emptyFlags> {
    const flags = emptyFlags();
    if (index === YELLOW_CAR) flags.yellow = this.timeS % 30 < 10;
    if (index === REPAIR_CAR) flags.repair = true;
    return flags;
  }

  private distance(index: number): number {
    // Cars start staggered behind the line, faster cars catch the slower ones in time.
    const offset =
      index === RIVAL_CAR
        ? this.carCount * 0.012 + RIVAL_LEAD_LAPS
        : (this.carCount - index) * 0.012;
    const laps = index === LAP_UP_CAR ? LAP_UP_LAPS : index === LAP_DOWN_CAR ? -1 : 0;
    return offset + laps + this.timeS / lapTimeOf(index);
  }

  private car(index: number, distance: number, position: number, classPosition: number): Car {
    const cls = classOf(index);
    const car = emptyCar(index);
    const lapsCompleted = Math.max(0, Math.floor(distance));
    car.driverName = `Mock Driver ${index}`;
    car.carName = cls.name;
    car.classId = cls.id;
    car.className = cls.name;
    car.classColour = cls.colour;
    car.carNumber = String(index + 1);
    car.position = position;
    car.classPosition = classPosition;
    const started = distance >= 0;
    car.lapsCompleted = started ? lapsCompleted : null;
    car.lapInProgress = started ? lapsCompleted + 1 : null;
    car.lapDistPct = distance - Math.floor(distance);
    car.onPitRoad = false;
    car.inPitStall = false;
    car.isOnTrack = true;
    car.lastLapS = lapsCompleted >= 1 ? lapTimeOf(index) : null;
    car.bestLapS = lapsCompleted >= 1 ? lapTimeOf(index) - 0.4 : null;
    car.estTimeS = car.lapDistPct * lapTimeOf(index);
    car.isPaceCar = false;
    car.isPlayer = index === 0;
    car.iRating =
      MOCK_IRATINGS[index % MOCK_IRATINGS.length]! + Math.floor(index / MOCK_IRATINGS.length) * 37;
    car.license = "A 3.00";
    car.connected = true;
    car.flags = this.carFlags(index);
    car.trackSurface = carSurface(index, distance);
    if (cls === HYPER) {
      car.p2pCount = 10 - ((Math.floor(this.timeS / 15) + index) % 11);
      car.p2pActive = this.timeS % 15 < 3;
    }
    return car;
  }
}

/**
 * Per corner [wear per lap, surface middle temp in the window (C), inner-minus-outer spread (C),
 * cold pressure (kPa)]: the front right works hardest, the rears least.
 */
const MOCK_TYRES: Readonly<
  Record<"fl" | "fr" | "rl" | "rr", readonly [number, number, number, number]>
> = {
  fl: [0.0045, 91, 7, 160],
  fr: [0.006, 93, 7, 162],
  rl: [0.0035, 88, 5, 158],
  rr: [0.004, 89, 5, 159],
};

/**
 * The player's tyres: one Medium set from the start, wearing with distance and warming into the
 * window over the first lap; brakes heat with the pedal. Plausible values only, for previews.
 */
function mockTyres(distanceLaps: number, brake: number): TyreSet {
  const warm = 1 - Math.exp(-3 * Math.max(0, distanceLaps));
  const corner = (key: keyof typeof MOCK_TYRES, front: boolean): TyreCorner => {
    const [perLap, window, spread, coldKpa] = MOCK_TYRES[key];
    const middle = 25 + (window - 25) * warm + (front ? 4 : 2) * brake;
    const inner = middle + (spread / 2) * warm;
    const outer = middle - (spread / 2) * warm;
    const layer = { inner: inner - 2, middle: middle - 2, outer: outer - 2 };
    return {
      temps: { inner, middle, outer },
      innerLayerTemps: layer,
      carcassTempC: middle - 4,
      brakeTempC: 30 + ((front ? 460 : 390) - 30) * warm + (front ? 220 : 150) * brake,
      pressureKpa: coldKpa + 0.18 * (middle - 25),
      wear: Math.min(1, perLap * Math.max(0, distanceLaps)),
      compound: "Medium",
    };
  };
  return {
    fl: corner("fl", true),
    fr: corner("fr", true),
    rl: corner("rl", false),
    rr: corner("rr", false),
    frontCompound: "Medium",
    rearCompound: "Medium",
  };
}

/** 1 on the straights, dipping through each corner (compact cosine dips). */
function shapeAt(f: number): number {
  let dip = 0;
  for (const [centre, half, depth] of CORNERS) {
    const x = Math.abs(f - centre);
    if (x < half) dip += depth * 0.5 * (1 + Math.cos((Math.PI * x) / half));
  }
  return 1 - dip;
}

/** Shape of the demo track on the ground plane, as a closed curve over t in 0..2pi (unitless). */
function worldShape(t: number): [number, number] {
  return [
    Math.cos(t) - 0.22 * Math.cos(2 * t) + 0.06 * Math.sin(3 * t) + 0.05 * Math.cos(5 * t),
    0.62 * Math.sin(t) + 0.16 * Math.sin(2 * t) - 0.07 * Math.cos(3 * t) + 0.06 * Math.sin(4 * t),
  ];
}

const WORLD_BINS = 2000;

/** The shape walked at equal steps of distance and scaled to TRACK_LENGTH_M: bin k at lap k/bins. */
const WORLD_PATH: readonly (readonly [number, number])[] = (() => {
  const dense = Array.from({ length: WORLD_BINS * 4 }, (_, i) =>
    worldShape((2 * Math.PI * i) / (WORLD_BINS * 4)),
  );
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i % dense.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[dense.length]!;
  const scale = TRACK_LENGTH_M / total;
  const out: [number, number][] = [];
  let j = 0;
  for (let k = 0; k < WORLD_BINS; k++) {
    const d = (k / WORLD_BINS) * total;
    while (cum[j + 1]! < d) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % dense.length]!;
    const f = (d - cum[j]!) / (cum[j + 1]! - cum[j]! || 1);
    out.push([(a[0] + (b[0] - a[0]) * f) * scale, (a[1] + (b[1] - a[1]) * f) * scale]);
  }
  return out;
})();

/** World position (x, z on the ground, metres) at a lap fraction of the demo track. */
function worldPosAt(fraction: number): Vec3 {
  const at = (((fraction % 1) + 1) % 1) * WORLD_BINS;
  const i = Math.min(Math.floor(at), WORLD_BINS - 1);
  const f = at - i;
  const a = WORLD_PATH[i]!;
  const b = WORLD_PATH[(i + 1) % WORLD_BINS]!;
  return { x: a[0] + (b[0] - a[0]) * f, y: 0, z: a[1] + (b[1] - a[1]) * f };
}

/** Steering demand: each corner turns the wheel, alternating left and right. */
function steerAt(f: number): number {
  let steer = 0;
  CORNERS.forEach(([centre, half, depth], i) => {
    const x = Math.abs(f - centre);
    if (x < half)
      steer += (i % 2 === 0 ? 1 : -1) * (depth / 0.5) * 0.5 * (1 + Math.cos((Math.PI * x) / half));
  });
  return Math.max(-1, Math.min(1, steer));
}

/** Cumulative time over the nominal lap (profile scale 1) at each bin edge, seconds. */
const TIME_AT_BIN: readonly number[] = (() => {
  const raw = [0];
  for (let i = 0; i < PROFILE_BINS; i++) {
    const a = 1 / shapeAt(i / PROFILE_BINS);
    const b = 1 / shapeAt((i + 1) / PROFILE_BINS);
    raw.push((raw[i] ?? 0) + (0.5 * (a + b)) / PROFILE_BINS);
  }
  const total = raw[PROFILE_BINS] ?? 1;
  return raw.map((v) => (v * NOMINAL_LAP_S) / total);
})();
/** Top speed such that the nominal lap takes exactly NOMINAL_LAP_S. */
const TOP_SPEED_MPS = (() => {
  let integral = 0;
  for (let i = 0; i < PROFILE_BINS; i++) {
    integral +=
      (0.5 * (1 / shapeAt(i / PROFILE_BINS) + 1 / shapeAt((i + 1) / PROFILE_BINS))) / PROFILE_BINS;
  }
  return (TRACK_LENGTH_M * integral) / NOMINAL_LAP_S;
})();

/** Lap time of the player's lap `index` (0-based), seconds. */
function playerLapTime(index: number): number {
  return NOMINAL_LAP_S + (LAP_VARIATION_S[index % LAP_VARIATION_S.length] ?? 0);
}
const VARIATION_CYCLE_S = LAP_VARIATION_S.reduce((sum, v) => sum + NOMINAL_LAP_S + v, 0);

/** Lap fraction reached `nominalS` seconds into a lap driven at the profile's own pace. */
function fractionAtNominalTime(nominalS: number): number {
  let lo = 0;
  let hi = PROFILE_BINS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((TIME_AT_BIN[mid] ?? 0) <= nominalS) lo = mid;
    else hi = mid;
  }
  const t0 = TIME_AT_BIN[lo] ?? 0;
  const t1 = TIME_AT_BIN[hi] ?? t0 + 1;
  return Math.min(1 - 1e-12, (lo + (nominalS - t0) / (t1 - t0)) / PROFILE_BINS);
}

/** Where the player is `timeS` into the demo: a pure function of time, so replays are exact. */
interface PlayerPose {
  /** Completed laps. */
  lapIndex: number;
  /** Seconds since the start of the current lap. */
  intoS: number;
  /** This lap's pace factor against the nominal lap (>1 is faster). */
  pace: number;
  fraction: number;
  speedMps: number;
  accelMps2: number;
}

function playerPose(timeS: number, startIntoS: number): PlayerPose {
  let rest = timeS + startIntoS;
  const cycles = Math.floor(rest / VARIATION_CYCLE_S);
  rest -= cycles * VARIATION_CYCLE_S;
  let k = 0;
  while (k < LAP_VARIATION_S.length - 1 && rest >= playerLapTime(k)) {
    rest -= playerLapTime(k);
    k++;
  }
  const pace = NOMINAL_LAP_S / playerLapTime(k);
  const fraction = fractionAtNominalTime(rest * pace);
  const speedMps = TOP_SPEED_MPS * shapeAt(fraction) * pace;
  const h = 1e-3;
  const slope =
    (shapeAt(Math.min(1, fraction + h)) - shapeAt(Math.max(0, fraction - h))) /
    (Math.min(1, fraction + h) - Math.max(0, fraction - h));
  const accelMps2 = (speedMps * TOP_SPEED_MPS * pace * slope) / TRACK_LENGTH_M;
  return {
    lapIndex: cycles * LAP_VARIATION_S.length + k,
    intoS: rest,
    pace,
    fraction,
    speedMps,
    accelMps2,
  };
}

/**
 * The player's lap timing. The delta channels are exact: against a reference lap of time R, a
 * lap of time T is (T - R) / T * (seconds into the lap) behind at every point of the track.
 */
function playerLap(pose: PlayerPose): NonNullable<SimState["player"]["lap"]> {
  const lapsCompleted = pose.lapIndex;
  const lapS = playerLapTime(lapsCompleted);
  const ok = pose.intoS >= DELTA_SETTLE_S;
  let best: number | null = null;
  for (let lap = 0; lap < Math.min(lapsCompleted, LAP_VARIATION_S.length); lap++) {
    const time = playerLapTime(lap);
    best = best === null ? time : Math.min(best, time);
  }
  const last = lapsCompleted >= 1 ? playerLapTime(lapsCompleted - 1) : null;
  const channel = (reference: number | null) => {
    const rate = (lapS - (reference ?? NOMINAL_LAP_S)) / lapS;
    return { s: rate * pose.intoS, ok, rate };
  };
  return {
    currentLapS: pose.intoS,
    lastLapS: last,
    bestLapS: best,
    delta: { best: channel(best), sessionBest: channel(best), sessionLast: channel(last) },
  };
}

function gearAt(speedMps: number): { gear: number; fraction: number } {
  const first = GEAR_BANDS[0] ?? [25, 30, 3];
  const last = GEAR_BANDS[GEAR_BANDS.length - 1] ?? [46, 55, 6];
  const [from, to, gear] =
    speedMps < first[0]
      ? first
      : (GEAR_BANDS.find(([lo, hi]) => speedMps >= lo && speedMps < hi) ?? last);
  const fraction = Math.min(1, Math.max(0, (speedMps - from) / (to - from)));
  return { gear, fraction };
}

function carSurface(index: number, distance: number): NonNullable<Car["trackSurface"]> {
  const lap = Math.floor(distance);
  const f = distance - lap;
  const wide =
    (index === OFF_TRACK_CAR && f >= OFF_TRACK_FROM && f < OFF_TRACK_TO) ||
    (index === OFF_TRACK_CAR_2 && lap % 2 === 1 && f >= OFF_TRACK_2_FROM && f < OFF_TRACK_2_TO);
  return wide ? "offTrack" : "onTrack";
}

function classOf(index: number): typeof GT3 {
  return index % 5 === 4 ? HYPER : GT3;
}

function lapTimeOf(index: number): number {
  if (index === RIVAL_CAR) return NOMINAL_LAP_S;
  return classOf(index).lapS * (1 + (index % 7) * 0.004);
}

/** Track temperature: 31 °C drifting slowly up and back by up to 0.8 °C over half an hour. */
function trackTempAt(timeS: number): number {
  return Math.round((31 + 0.8 * Math.sin((2 * Math.PI * timeS) / TRACK_TEMP_PERIOD_S)) * 10) / 10;
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
