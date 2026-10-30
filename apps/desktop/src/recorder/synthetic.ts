import { emptyCar, emptySimState, type SimSource, type SimState } from "@overlay/sim-core";

/** Test helper: a small race of one player car with exact, known laps, stops and incidents. */

export interface SyntheticOptions {
  source?: SimSource;
  sessionType?: SimState["session"]["type"];
  /** Seconds of session time at the first tick. */
  startS?: number;
  lapTimeS?: number;
  tickS?: number;
  laps?: number;
  /** Litres burnt per lap. */
  fuelPerLap?: number;
  startFuelL?: number;
  /** Pit stop that begins on this lap (the lap in progress at entry), if any. */
  pitOnLap?: number;
  stallS?: number;
  refuelL?: number;
  /** Incident count increases as [sessionTimeS offset from the start, points]. */
  incidentsAt?: [number, number][];
  /** Time the sim reports a lap, as a difference to the true lap time. */
  reportedLapOffsetS?: number;
  trackName?: string;
  /** Session seconds to keep going after the last line crossing. Default 12. */
  tailS?: number;
  /** False: the sim never reports lap times, so the recorder falls back to the crossings. */
  reportLastLap?: boolean;
  /** Give the other car a name, to prove that it is never stored. */
  otherDriverName?: string;
}

/** The lap time the sim reports for synthetic lap `lap` (1-based); it differs from lap to lap. */
export function syntheticLapTime(lap: number, options: SyntheticOptions = {}): number {
  return (options.lapTimeS ?? 60) + (options.reportedLapOffsetS ?? -0.013) + 0.001 * lap;
}

export function* syntheticSession(options: SyntheticOptions = {}): Generator<SimState> {
  const lapTimeS = options.lapTimeS ?? 60;
  const tickS = options.tickS ?? 0.1;
  const laps = options.laps ?? 4;
  const fuelPerLap = options.fuelPerLap ?? 2;
  const stallS = options.stallS ?? 6;
  const refuelL = options.refuelL ?? 30;
  const startS = options.startS ?? 1000;
  const incidents = options.incidentsAt ?? [];

  const startFuelL = options.startFuelL ?? 40;
  let refuelled = 0;
  let incidentCount = 0;
  let lastLapS: number | null = null;
  let completed = 0;
  let pending: number | null = null;
  // Pit sequence state: 0 none, 1 approaching, 2 stopped, 3 leaving, 4 done.
  let pit = 0;
  let stallLeft = 0;
  const total = Math.round((laps * lapTimeS + (options.tailS ?? 12)) / tickS);

  for (let i = 0; i <= total; i++) {
    const t = startS + i * tickS;
    const elapsed = i * tickS;
    for (const [at, points] of incidents) {
      if (Math.abs(elapsed - at) < tickS / 2) incidentCount += points;
    }
    const lapsRun = elapsed / lapTimeS;
    const nowCompleted = Math.floor(lapsRun + 1e-9);
    const pct = Math.max(0, lapsRun - nowCompleted);
    if (nowCompleted > completed) {
      completed = nowCompleted;
      pending = options.reportLastLap === false ? null : syntheticLapTime(completed, options);
    } else if (pending !== null && i > 0) {
      // The sim reports the time of the lap one tick after the line.
      lastLapS = pending;
      pending = null;
    }

    const pitLap = options.pitOnLap ?? -10;
    if (options.pitOnLap !== undefined && pit === 0 && completed + 1 === pitLap && pct >= 0.9)
      pit = 1;
    if (pit === 1 && completed + 1 === pitLap + 1 && pct >= 0.02) {
      pit = 2;
      stallLeft = stallS;
    }
    if (pit === 2) {
      stallLeft -= tickS;
      refuelled += (refuelL / stallS) * tickS;
      if (stallLeft <= 0) pit = 3;
    }
    if (pit === 3 && pct >= 0.1) pit = 4;
    const onPitRoad = pit >= 1 && pit <= 3;
    const inPitStall = pit === 2;

    const state = emptySimState(options.source ?? "iracing");
    state.connected = true;
    state.tickTimeS = t;
    state.playerCarIdx = 0;
    state.session.type = options.sessionType ?? "race";
    state.session.phase = "racing";
    state.session.timing = "laps";
    state.session.lapsTotal = laps;
    state.session.trackName = options.trackName ?? "Test Circuit";
    state.session.trackLengthM = 5000;
    state.conditions.trackTempC = 31;
    state.conditions.airTempC = 22;
    state.conditions.wetness = 0;
    const player = emptyCar(0);
    player.connected = true;
    player.carName = "Test GT3";
    player.className = "GT3";
    player.carNumber = "77";
    player.position = 3;
    player.lapsCompleted = completed;
    player.lapInProgress = completed + 1;
    player.lapDistPct = pct;
    player.onPitRoad = onPitRoad;
    player.inPitStall = inPitStall;
    player.isOnTrack = !onPitRoad;
    player.lastLapS = lastLapS;
    player.isPlayer = true;
    const other = emptyCar(1);
    other.connected = true;
    other.driverName = options.otherDriverName ?? null;
    other.position = 2;
    other.lapsCompleted = completed;
    other.lapDistPct = (pct + 0.05) % 1;
    state.cars = [player, other];
    state.player.fuelL = startFuelL - fuelPerLap * lapsRun + refuelled;
    state.player.fuelCapacityL = 80;
    state.player.speedMps = 60 + 10 * Math.sin(t);
    state.player.gear = 4;
    state.player.rpm = 7000;
    state.player.inputs = { throttle: 0.8, brake: 0, clutch: 0, steer: 0.1 };
    state.player.incidentCount = incidentCount;
    yield state;
  }
}
