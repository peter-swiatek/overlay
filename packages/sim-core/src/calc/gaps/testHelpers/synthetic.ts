import type { MiniSectorRecorder } from "../miniSectorRecorder";
import type { GapCompletedLap, GapCarTick } from "../types";

/** A lap profile: each segment ends at `endPct` and takes `durS` seconds. */
export interface Segment {
  endPct: number;
  durS: number;
}

/** Slow first half (60 s), fast second half (30 s): 90 s lap. */
export const SLOW_FAST: Segment[] = [
  { endPct: 0.5, durS: 60 },
  { endPct: 1, durS: 30 },
];

export function profileLapTime(profile: Segment[]): number {
  return profile.reduce((sum, s) => sum + s.durS, 0);
}

/** Elapsed seconds into the lap at `pct`. */
export function timeAt(profile: Segment[], pct: number): number {
  let startPct = 0;
  let t = 0;
  for (const s of profile) {
    if (pct <= s.endPct) return t + ((pct - startPct) / (s.endPct - startPct)) * s.durS;
    startPct = s.endPct;
    t += s.durS;
  }
  return t;
}

/** Lap fraction (0..1) at `seconds` into the lap. */
export function pctAt(profile: Segment[], seconds: number): number {
  let startPct = 0;
  let t = 0;
  for (const s of profile) {
    if (seconds <= t + s.durS) return startPct + ((seconds - t) / s.durS) * (s.endPct - startPct);
    startPct = s.endPct;
    t += s.durS;
  }
  return 1;
}

export interface DriveOptions {
  carIdx: number;
  profile: Segment[];
  /** Session time at which the car is at lap fraction `startPct` of lap `firstLap`. */
  startTimeS: number;
  startPct?: number;
  firstLap?: number;
  laps: number;
  dtS?: number;
  classId?: number;
  /** Mutate a tick (set pit road, off track, ...) given its lap and fraction. */
  mutate?: (tick: GapCarTick) => void;
}

/** Drives one car through `laps` laps, feeding the recorder; returns every completed lap. */
export function driveCar(recorder: MiniSectorRecorder, opts: DriveOptions): GapCompletedLap[] {
  const dt = opts.dtS ?? 0.0137;
  const lapTimeS = profileLapTime(opts.profile);
  const startPct = opts.startPct ?? 0;
  const firstLap = opts.firstLap ?? 1;
  const startOffset = timeAt(opts.profile, startPct);
  const endOffset = lapTimeS * opts.laps - startOffset;
  const completed: GapCompletedLap[] = [];
  for (let e = 0; e <= endOffset + dt; e += dt) {
    const total = startOffset + Math.min(e, endOffset);
    const lapsDone = Math.floor(total / lapTimeS + 1e-12);
    const tick: GapCarTick = {
      sessionTimeS: opts.startTimeS + Math.min(e, endOffset),
      carIdx: opts.carIdx,
      lap: firstLap + lapsDone,
      lapDistPct: pctAt(opts.profile, total - lapsDone * lapTimeS) % 1,
      onPitRoad: false,
      offTrack: false,
      ...(opts.classId === undefined ? {} : { classId: opts.classId }),
    };
    opts.mutate?.(tick);
    const done = recorder.update(tick);
    if (done) completed.push(done);
    if (e >= endOffset) break;
  }
  return completed;
}
