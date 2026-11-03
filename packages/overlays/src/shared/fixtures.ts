// Test support only. Type imports from sim-core, never a value import, so this can not pull Node
// code into a bundle.
import type {
  Car,
  Conditions,
  DerivedGap,
  Flags,
  Player,
  SessionInfo,
  SimName,
  SimState,
  Standings,
  StandingsEntry,
  TelemetryFrame,
} from "@overlay/sim-core/types";

/** Invented names for tests. */
export const FIXTURE_NAMES: readonly string[] = [
  "Max Example",
  "José María Pérez",
  "Zofia Świątkowska",
  "Ada Testova",
  "Ben Sample",
  "Clara Fictional",
  "Dmitri Placeholder",
  "Elif Mockoglu",
];

function baseCar(carIdx: number): Car {
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
    connected: true,
  };
}

function baseEntry(carIdx: number): StandingsEntry {
  return {
    carIdx,
    position: null,
    classPosition: null,
    livePosition: null,
    liveClassPosition: null,
    progressLaps: null,
    gapToLeader: null,
    gapToClassLeader: null,
    interval: null,
    avgLapS: null,
    sessionBest: false,
    classBest: false,
    pitStops: 0,
    lastPitLap: null,
    stintLaps: null,
    prevStintLaps: null,
    startPosition: null,
    iRatingChange: null,
  };
}

const NO_FLAGS: Flags = {
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

/** A live TelemetryFrame built from plain objects. */
export function fixtureFrame(input: {
  sim?: SimName;
  cars: Array<Partial<Car> & { carIdx: number }>;
  playerCarIdx?: number | null;
  standings?: Array<Partial<StandingsEntry> & { carIdx: number }>;
  /** Extra Standings fields (sof, class bests); the entries come from `standings`. */
  standingsInfo?: Partial<Omit<Standings, "entries">>;
  gaps?: DerivedGap[];
  session?: Partial<SessionInfo>;
  conditions?: Partial<Conditions>;
  flags?: Partial<Flags> | null;
  player?: Partial<Player>;
}): TelemetryFrame {
  const playerCarIdx = input.playerCarIdx === undefined ? null : input.playerCarIdx;
  const state: SimState = {
    version: 1,
    source: "mock",
    sim: input.sim ?? "iracing",
    connected: true,
    tickTimeS: 100,
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
      ...input.session,
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
      ...input.conditions,
    },
    flags: input.flags ? { ...NO_FLAGS, ...input.flags } : null,
    playerCarIdx,
    focusCarIdx: playerCarIdx,
    cars: input.cars.map((c) => ({ ...baseCar(c.carIdx), ...c })),
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
      ...input.player,
    },
  };
  const standings: Standings | null = input.standings
    ? {
        entries: input.standings.map((e) => ({ ...baseEntry(e.carIdx), ...e })),
        sessionBestLapS: null,
        classBestLapS: {},
        sof: null,
        classSof: {},
        ...input.standingsInfo,
      }
    : null;
  return {
    seq: 1,
    source: "mock",
    status: "live",
    error: null,
    state,
    derived: {
      fuel: null,
      energy: null,
      gaps: input.gaps ?? [],
      track: { trackKey: null, outlineReady: false },
      standings,
      proximity: null,
      delta: null,
      slowCar: null,
    },
  };
}
