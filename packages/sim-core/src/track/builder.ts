import { closedLength } from "./outline";
import {
  OUTLINE_POINTS,
  type LapResult,
  type OutlineSource,
  type RejectReason,
  type TrackOutline,
  type TrackSample,
} from "./types";

/** iRacing ticks at about 57 Hz; a bigger hole means lost samples. LMU scoring runs at 5 Hz. */
const MAX_GAP_S: Record<OutlineSource, number> = { integrated: 0.1, world: 0.5 };
/** The lap must begin this close to the line; a pit exit may start later but only for world data. */
const MAX_START_PCT: Record<OutlineSource, number> = { integrated: 0.02, world: 0.05 };
const MIN_END_PCT = 0.98;
/** A forward jump of more than this between two ticks is a teleport or a hole. */
const MAX_PCT_STEP = 0.02;
/**
 * lapDistPct may go back by this much (26 m at VIR) below its highest value, e.g. a car rolling
 * back or spinning; those ticks are not stored. A bigger step back is a reset or a tow.
 */
const MAX_REVERSE_PCT = 0.005;
const WRAP_FROM = 0.9;
const WRAP_TO = 0.1;
const SLOW_LAP_FACTOR = 1.07;
const MIN_SAMPLES = 100;
/** A tick clock that goes back by more than this is a new session or a restarted replay. */
const CLOCK_BACKWARDS_S = 1;

export const MAX_CLOSURE_FRACTION = 0.02;
export const MAX_LENGTH_ERROR = 0.03;

export interface BuilderOptions {
  trackKey: string;
  /** The sim's track length, to reject laps that are not one lap of this layout. */
  trackLengthM?: number | null;
  /** Injectable clock, so builds are reproducible in tests. */
  now?: () => Date;
}

interface Lap {
  source: OutlineSource | null;
  rejected: { reason: RejectReason; detail?: string } | null;
  startPct: number;
  /** Highest lapDistPct stored; only a tick above it adds a point. */
  maxPct: number;
  /** Pit road samples before the first sample on the track (an out lap) are not part of the path. */
  inPitPrefix: boolean;
  pct: number[];
  x: number[];
  y: number[];
  firstTickS: number;
  lastTickS: number;
  bestLapS: number | null;
  /** Integrated path so far and the velocity at the previous sample, in metres and m/s. */
  east: number;
  north: number;
  prevEast: number;
  prevNorth: number;
}

/**
 * Builds a {@link TrackOutline} from the player's own laps, one tick at a time.
 *
 * iRacing gives only the player's velocity (car frame) and heading, so the path is integrated and
 * the drift spread evenly along it until the end meets the start. LMU gives world positions, which
 * are used as they are. A lap counts only if it is clean: no pit road (except a pit exit at the
 * start of a world-position lap), always in the world, no hole in the ticks, lapDistPct always
 * rising, and no slower than 107% of the best lap.
 */
export class TrackOutlineBuilder {
  private lap: Lap | null = null;
  private lastTickS: number | null = null;
  private lastPct: number | null = null;

  constructor(private readonly options: BuilderOptions) {}

  /** Forget the lap in progress, e.g. after a session change. */
  reset(): void {
    this.lap = null;
    this.lastTickS = null;
    this.lastPct = null;
  }

  /** The result for a lap that has just ended (the sample crossed the line), else null. */
  push(sample: TrackSample): LapResult | null {
    if (!Number.isFinite(sample.tickS) || !Number.isFinite(sample.lapDistPct)) return null;
    const last = this.lastTickS;
    if (last !== null && sample.tickS <= last) {
      // The same tick twice is normal for a 5 Hz source read faster; the clock going far back is not.
      if (sample.tickS < last - CLOCK_BACKWARDS_S) this.reset();
      else return null;
    }
    this.lastTickS = sample.tickS;
    const prevPct = this.lastPct;
    const dtS = last === null ? 0 : sample.tickS - last;
    const pct = sample.lapDistPct;
    const wrapped = prevPct !== null && prevPct > WRAP_FROM && pct < WRAP_TO;

    let result: LapResult | null = null;
    if (wrapped) {
      result = this.finish(sample.bestLapS);
      this.lap = null;
    }
    const lap = this.lap ?? newLap(sample);
    this.lap = lap;
    const checked = !wrapped && prevPct !== null && !lap.inPitPrefix && lap.rejected === null;
    if (checked) checkContinuity(lap, sample, prevPct, dtS);
    this.lastPct = pct;
    if (lap.rejected === null) addToLap(lap, sample);
    return result;
  }

  /** Judge the lap in progress as if the line had been crossed now: for tests and shutdown. */
  finishNow(): LapResult {
    const result = this.finish(null);
    this.lap = null;
    return result;
  }

  private finish(nextBestLapS: number | null): LapResult {
    const lap = this.lap;
    if (lap === null) return { ok: false, reason: "incomplete", detail: "no lap" };
    if (lap.rejected !== null) return { ok: false, ...lap.rejected };
    const source = lap.source;
    const n = lap.pct.length;
    const first = lap.pct[0];
    const lastPct = lap.pct[n - 1];
    if (source === null || first === undefined || lastPct === undefined || n < MIN_SAMPLES) {
      return { ok: false, reason: "incomplete", detail: `${n} samples` };
    }
    if (lastPct < MIN_END_PCT || first > MAX_START_PCT[source]) {
      return { ok: false, reason: "incomplete", detail: `covers ${first}..${lastPct}` };
    }
    const lapS = (lap.lastTickS - lap.firstTickS) / (lastPct - first) || 0;
    const best = Math.min(lap.bestLapS ?? Infinity, nextBestLapS ?? Infinity);
    if (Number.isFinite(best) && lapS > best * SLOW_LAP_FACTOR) {
      return { ok: false, reason: "slow-lap", detail: `${lapS.toFixed(1)} s vs best ${best} s` };
    }
    return buildOutline(lap, source, this.options);
  }
}

function checkContinuity(lap: Lap, sample: TrackSample, prevPct: number, dtS: number): void {
  const source = lap.source ?? sourceOf(sample) ?? "integrated";
  if (dtS > MAX_GAP_S[source])
    return reject(lap, "tick-gap", `${dtS.toFixed(2)} s at ${sample.tickS.toFixed(1)} s`);
  if (lap.maxPct - sample.lapDistPct > MAX_REVERSE_PCT) reject(lap, "not-monotonic");
  else if (sample.lapDistPct - prevPct > MAX_PCT_STEP) reject(lap, "tick-gap", "lapDistPct jumped");
}

function addToLap(lap: Lap, sample: TrackSample): void {
  const source = sourceOf(sample);
  if (source === null) return reject(lap, "no-position");
  if (lap.source === null) {
    lap.source = source;
    if (lap.startPct > MAX_START_PCT[source]) return reject(lap, "incomplete", "started mid-lap");
  } else if (lap.source !== source) {
    return reject(lap, "mixed-sources");
  }
  if (sample.onPitRoad) {
    // Only a world-position lap may begin in the pits: its path is just not recorded there.
    if (lap.inPitPrefix && source === "world") {
      lap.lastTickS = sample.tickS;
      return;
    }
    return reject(lap, "pit-road");
  }
  if (!sample.onTrack) return reject(lap, "off-track");
  lap.inPitPrefix = false;
  if (sample.bestLapS !== null) lap.bestLapS = Math.min(lap.bestLapS ?? Infinity, sample.bestLapS);
  extendPath(lap, sample, source);
}

function extendPath(lap: Lap, sample: TrackSample, source: OutlineSource): void {
  if (lap.pct.length === 0) lap.firstTickS = sample.tickS;
  const store = sample.lapDistPct > lap.maxPct;
  if (source === "world" && sample.worldPos !== null) {
    if (store) {
      lap.x.push(sample.worldPos.x);
      // z is north in LMU; the screen's y points down.
      lap.y.push(-sample.worldPos.z);
    }
  } else {
    const v = eastNorth(sample);
    if (v === null) return reject(lap, "no-position");
    if (lap.pct.length > 0) {
      const dt = sample.tickS - lap.lastTickS;
      lap.east += ((lap.prevEast + v.east) / 2) * dt;
      lap.north += ((lap.prevNorth + v.north) / 2) * dt;
    }
    lap.prevEast = v.east;
    lap.prevNorth = v.north;
    if (store) {
      lap.x.push(lap.east);
      lap.y.push(-lap.north);
    }
  }
  if (store) {
    lap.pct.push(sample.lapDistPct);
    lap.maxPct = sample.lapDistPct;
  }
  lap.lastTickS = sample.tickS;
}

function newLap(sample: TrackSample): Lap {
  return {
    source: null,
    rejected: null,
    startPct: sample.lapDistPct,
    maxPct: -1,
    inPitPrefix: true,
    pct: [],
    x: [],
    y: [],
    firstTickS: sample.tickS,
    lastTickS: sample.tickS,
    bestLapS: null,
    east: 0,
    north: 0,
    prevEast: 0,
    prevNorth: 0,
  };
}

function reject(lap: Lap, reason: RejectReason, detail?: string): void {
  if (lap.rejected === null) lap.rejected = detail === undefined ? { reason } : { reason, detail };
}

function sourceOf(sample: TrackSample): OutlineSource | null {
  if (sample.worldPos !== null) return "world";
  return sample.headingRad !== null && sample.velocityMps !== null ? "integrated" : null;
}

/**
 * Heading is clockwise from north (compass style); the car frame has x forward and y to the left.
 * This sign is the one that makes VIR, a clockwise track, run clockwise in the recordings.
 */
function eastNorth(sample: TrackSample): { east: number; north: number } | null {
  const h = sample.headingRad;
  const v = sample.velocityMps;
  if (h === null || v === null) return null;
  const sin = Math.sin(h);
  const cos = Math.cos(h);
  return { east: v.x * sin - v.y * cos, north: v.x * cos + v.y * sin };
}

function buildOutline(lap: Lap, source: OutlineSource, options: BuilderOptions): LapResult {
  const n = lap.pct.length;
  const x = lap.x.slice();
  const y = lap.y.slice();
  const expectedM = options.trackLengthM ?? null;
  const dx = (x[n - 1] ?? 0) - (x[0] ?? 0);
  const dy = (y[n - 1] ?? 0) - (y[0] ?? 0);
  const gapPct = 1 - (lap.pct[n - 1] ?? 1) + (lap.pct[0] ?? 0);
  const pathM = pathLength(x, y);
  // Part of the lap is not in the data (the last metres before the line, a pit exit); allow for it.
  const missingM = gapPct * (expectedM ?? pathM);
  const closureErrorM = Math.max(0, Math.hypot(dx, dy) - missingM);
  if (source === "integrated") spreadDrift(x, y, dx, dy);

  const metres = resample(lap.pct, x, y);
  const lengthM = closedLength(metres);
  if (closureErrorM > MAX_CLOSURE_FRACTION * lengthM) {
    return {
      ok: false,
      reason: "closure",
      detail: `${closureErrorM.toFixed(1)} m of ${lengthM.toFixed(0)} m`,
    };
  }
  if (expectedM !== null && Math.abs(lengthM - expectedM) > MAX_LENGTH_ERROR * expectedM) {
    return {
      ok: false,
      reason: "length-mismatch",
      detail: `${lengthM.toFixed(0)} m vs ${expectedM.toFixed(0)} m`,
    };
  }
  const now = options.now?.() ?? new Date();
  const outline: TrackOutline = {
    version: 1,
    trackKey: options.trackKey,
    ...toUnitBox(metres),
    lengthM,
    source,
    closureErrorM,
    createdAt: now.toISOString(),
  };
  return { ok: true, outline };
}

function pathLength(x: readonly number[], y: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < x.length; i++) {
    total += Math.hypot((x[i] ?? 0) - (x[i - 1] ?? 0), (y[i] ?? 0) - (y[i - 1] ?? 0));
  }
  return total;
}

/** Moves each point back by its share (by distance travelled) of the drift (dx, dy). */
function spreadDrift(x: number[], y: number[], dx: number, dy: number): void {
  const along = [0];
  for (let i = 1; i < x.length; i++) {
    const step = Math.hypot((x[i] ?? 0) - (x[i - 1] ?? 0), (y[i] ?? 0) - (y[i - 1] ?? 0));
    along.push((along[i - 1] ?? 0) + step);
  }
  const total = along[along.length - 1] ?? 0;
  if (total === 0) return;
  for (let i = 0; i < x.length; i++) {
    const share = (along[i] ?? 0) / total;
    x[i] = (x[i] ?? 0) - dx * share;
    y[i] = (y[i] ?? 0) - dy * share;
  }
}

/**
 * Points at lapDistPct k / OUTLINE_POINTS by linear interpolation. The lap is a loop: the last
 * sample is repeated one lap earlier and the first one a lap later, so the stretch the data does
 * not cover (a few metres before the line, or a pit exit) is bridged by a straight segment.
 */
function resample(
  pct: readonly number[],
  x: readonly number[],
  y: readonly number[],
): [number, number][] {
  const n = pct.length;
  const at = (i: number): [number, number, number] => {
    if (i < 0) return [(pct[n - 1] ?? 1) - 1, x[n - 1] ?? 0, y[n - 1] ?? 0];
    if (i >= n) return [(pct[0] ?? 0) + 1, x[0] ?? 0, y[0] ?? 0];
    return [pct[i] ?? 0, x[i] ?? 0, y[i] ?? 0];
  };
  const out: [number, number][] = [];
  let j = -1;
  for (let k = 0; k < OUTLINE_POINTS; k++) {
    const target = k / OUTLINE_POINTS;
    while (j < n - 1 && at(j + 1)[0] <= target) j++;
    const [p0, x0, y0] = at(j);
    const [p1, x1, y1] = at(j + 1);
    const f = p1 > p0 ? (target - p0) / (p1 - p0) : 0;
    out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
  }
  return out;
}

function toUnitBox(metres: readonly [number, number][]): Pick<TrackOutline, "points" | "scaleM"> {
  const xs = metres.map((p) => p[0]);
  const ys = metres.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const height = Math.max(...ys) - minY;
  const scaleM = Math.max(width, height) || 1;
  const offX = (1 - width / scaleM) / 2;
  const offY = (1 - height / scaleM) / 2;
  const points = metres.map(([px, py]): [number, number] => [
    round5((px - minX) / scaleM + offX),
    round5((py - minY) / scaleM + offY),
  ]);
  return { points, scaleM };
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
