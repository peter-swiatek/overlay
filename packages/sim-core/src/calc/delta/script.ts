/**
 * Test helper: turns a lap script into a sequence of SimStates at a fixed tick. Not exported from
 * the package index.
 */
import {
  emptyCar,
  emptySimState,
  type PlayerLapDeltas,
  type SessionType,
  type SimSource,
  type SimState,
  type TrackSurface,
} from "../../model";

export interface ScriptLap {
  lapTimeS: number;
  /** Speed profile factor along the lap (default constant); elapsed time follows from it. */
  speedAt?: (pct: number) => number;
  incidentAtPct?: number;
  offTrack?: [fromPct: number, toPct: number];
  pitRoad?: [fromPct: number, toPct: number];
  /** The sim reports no lap time for this lap. */
  invalid?: boolean;
}

export interface ScriptOptions {
  sim: "iracing" | "lmu";
  sessionType: SessionType;
  sessionTypeName?: string;
  tickS?: number; // default 0.1
  /** Seconds after the line until lastLapS updates (iRacing-like 1.0, LMU 0). */
  lapTimeDelayS?: number;
  /** iRacing only: channel values per kind as a function of the script (default: computed from the script's own laps, ok after 2 s into a lap). */
  channels?: boolean;
  startOnPitRoad?: boolean;
  /** The SimState source (default: the sim); "replay" and "mock" keep the store unwritten. */
  source?: SimSource;
  /** Seconds to keep running after the last lap's line. Default: the time delay plus two ticks. */
  tailS?: number;
}

export const SCRIPT_TRACK_LENGTH_M = 4000;
export const SCRIPT_CAR_NAME = "Test Car";
const TABLE = 1000;
const CHANNEL_OK_AFTER_S = 2;

/** Cumulative time at each of TABLE + 1 equal steps of lap distance. */
function timeTable(lap: ScriptLap): number[] {
  const f = lap.speedAt ?? (() => 1);
  const inv: number[] = [];
  for (let k = 0; k < TABLE; k++) inv.push(1 / Math.max(1e-6, f((k + 0.5) / TABLE)));
  const sum = inv.reduce((a, b) => a + b, 0);
  const out = [0];
  for (const v of inv) out.push((out[out.length - 1] ?? 0) + (lap.lapTimeS * v) / sum);
  return out;
}

function timeAtPct(table: readonly number[], pct: number): number {
  const pos = Math.min(1, Math.max(0, pct)) * TABLE;
  const k = Math.min(TABLE - 1, Math.floor(pos));
  const a = pos - k;
  return (table[k] ?? 0) + a * ((table[k + 1] ?? 0) - (table[k] ?? 0));
}

function pctAtTime(table: readonly number[], t: number): number {
  const total = table[TABLE] ?? 0;
  if (t <= 0) return 0;
  if (t >= total) return 1;
  let lo = 0;
  let hi = TABLE;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((table[mid] ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  const t0 = table[lo] ?? 0;
  const t1 = table[lo + 1] ?? t0;
  return (lo + (t1 > t0 ? (t - t0) / (t1 - t0) : 0)) / TABLE;
}

function inWindow(w: [number, number] | undefined, pct: number): boolean {
  return w !== undefined && pct >= w[0] && pct <= w[1];
}

export function scriptStates(laps: readonly ScriptLap[], options: ScriptOptions): SimState[] {
  const tick = options.tickS ?? 0.1;
  const delay = options.lapTimeDelayS ?? (options.sim === "iracing" ? 1 : 0);
  const withChannels = options.sim === "iracing" && options.channels !== false;
  if (laps.length === 0) return [];
  const all: ScriptLap[] = [...laps, { lapTimeS: laps[laps.length - 1]!.lapTimeS }];
  const tables = all.map(timeTable);
  const starts: number[] = [];
  let acc = 0;
  for (const lap of all) {
    starts.push(acc);
    acc += lap.lapTimeS;
  }
  const end = starts[laps.length]! + (options.tailS ?? delay + 2 * tick);

  const timed = (i: number): number | null => {
    const lap = all[i];
    return lap === undefined || lap.invalid === true ? null : lap.lapTimeS;
  };

  const out: SimState[] = [];
  let lapIdx = 0;
  for (let n = 0; n * tick <= end + 1e-9; n++) {
    const t = n * tick;
    while (lapIdx + 1 < all.length && t >= starts[lapIdx + 1]! - 1e-9) lapIdx++;
    const lap = all[lapIdx]!;
    const table = tables[lapIdx]!;
    const e = Math.max(0, t - starts[lapIdx]!);
    const pct = Math.min(0.99999, pctAtTime(table, e));
    const pitStartWindow: [number, number] | undefined =
      options.startOnPitRoad === true && lapIdx === 0 ? [0, 0.05] : undefined;
    const onPitRoad = inWindow(lap.pitRoad, pct) || inWindow(pitStartWindow, pct);
    const offTrack = inWindow(lap.offTrack, pct);
    const surface: TrackSurface = offTrack ? "offTrack" : onPitRoad ? "inPitStall" : "onTrack";
    const h = 0.0005;
    const lo = Math.max(0, pct - h);
    const hi = Math.min(1, pct + h);
    const secPerPct = (timeAtPct(table, hi) - timeAtPct(table, lo)) / (hi - lo);
    const speedMps = SCRIPT_TRACK_LENGTH_M / secPerPct;

    const s = emptySimState(options.source ?? options.sim);
    s.sim = options.sim;
    s.connected = true;
    s.tickTimeS = t;
    s.session.type = options.sessionType;
    s.session.typeName = options.sessionTypeName ?? null;
    s.session.phase = "racing";
    s.session.trackName = "Script Ring";
    s.session.trackConfig = options.sim === "iracing" ? "Full Course" : null;
    s.session.trackLengthM = SCRIPT_TRACK_LENGTH_M;
    s.playerCarIdx = 0;
    s.focusCarIdx = 0;
    s.cars = [
      {
        ...emptyCar(0),
        connected: true,
        isPlayer: true,
        driverName: "Test Driver",
        carName: SCRIPT_CAR_NAME,
        className: "GT",
        classId: "1",
        lapsCompleted: lapIdx,
        lapInProgress: lapIdx + 1,
        lapDistPct: pct,
        onPitRoad,
        inPitStall: false,
        isOnTrack: !offTrack,
        trackSurface: surface,
      },
    ];

    const arrived = e >= delay - 1e-9;
    const shown = (idx: number): number | null => (idx >= 0 ? timed(idx) : null);
    const lastIdx = arrived ? lapIdx - 1 : lapIdx - 2;
    let lastLapS: number | null = null;
    let bestLapS: number | null = null;
    for (let i = 0; i <= lastIdx; i++) {
      const v = shown(i);
      if (v !== null && (bestLapS === null || v < bestLapS)) bestLapS = v;
    }
    lastLapS = shown(lastIdx);

    let incidents = 0;
    for (let i = 0; i <= lapIdx; i++) {
      const at = all[i]?.incidentAtPct;
      if (at !== undefined && (i < lapIdx || pct >= at)) incidents += 1;
    }

    s.player.speedMps = speedMps;
    // LMU reports neither incidents nor the track surface.
    const lmu = options.sim === "lmu";
    s.player.incidentCount = lmu ? null : incidents;
    s.player.trackSurface = lmu ? null : surface;
    s.player.isOnTrack = lmu ? null : !offTrack;
    if (lmu) {
      s.cars[0]!.trackSurface = null;
      s.cars[0]!.isOnTrack = null;
    }
    s.player.lap = {
      currentLapS: e,
      lastLapS,
      bestLapS,
      delta: withChannels ? channels(lapIdx, e) : null,
    };
    out.push(s);
  }
  return out;

  function channels(cur: number, elapsed: number): PlayerLapDeltas {
    let bestIdx = -1;
    for (let i = 0; i < cur; i++) {
      const v = timed(i);
      if (v !== null && (bestIdx < 0 || v < timed(bestIdx)!)) bestIdx = i;
    }
    let lastIdx = -1;
    for (let i = cur - 1; i >= 0; i--) {
      if (timed(i) !== null) {
        lastIdx = i;
        break;
      }
    }
    const channel = (ref: number) => {
      if (ref < 0) return { s: 0, ok: false, rate: null };
      const delta = (at: number): number =>
        at - timeAtPct(tables[ref]!, pctAtTime(tables[cur]!, at));
      const h = 0.05;
      const rate =
        (delta(elapsed + h) - delta(Math.max(0, elapsed - h))) /
        (elapsed + h - Math.max(0, elapsed - h));
      return { s: delta(elapsed), ok: elapsed >= CHANNEL_OK_AFTER_S, rate };
    };
    return { best: channel(bestIdx), sessionBest: channel(bestIdx), sessionLast: channel(lastIdx) };
  }
}
