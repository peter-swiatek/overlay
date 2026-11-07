import { traceTimeAt } from "./trace";
import type {
  DeltaReferenceKind,
  LapTrace,
  SectorDeltas,
  SectorState,
  SectorTiming,
} from "./types";

/** A step back by more than this, or forward by more than MAX_FORWARD, is a jump (tow, reset). */
const MAX_BACK = 0.01;
const MAX_FORWARD = 0.05;
/** Times closer than this are equal, seconds. */
const TIE_S = 0.0005;

const KINDS: readonly DeltaReferenceKind[] = [
  "allTimeBest",
  "sessionBestClean",
  "sessionBest",
  "lastLap",
];

/** A reference lap that has a distance trace. */
export interface SectorReference {
  kind: DeltaReferenceKind;
  trace: LapTrace;
  lapTimeS: number;
}

/** The sectors of one lap as they were completed. */
export interface LapSectors {
  times: (number | null)[];
  deltas: Partial<Record<DeltaReferenceKind, (number | null)[]>>;
  /** At or under the session best for that sector as it stood when the sector was completed. */
  fastest: boolean[];
  /** The lap is clean (so far, at the line, then as resolved). */
  clean: boolean;
}

interface Sample {
  pct: number;
  elapsedS: number;
  tickS: number;
}

/** Valid sector starts (first 0, strictly rising, all below 1), else null. */
export function validSectorStarts(starts: readonly number[] | null | undefined): number[] | null {
  if (starts === null || starts === undefined || starts.length === 0 || starts[0] !== 0) {
    return null;
  }
  for (let i = 0; i < starts.length; i++) {
    const v = starts[i]!;
    if (!Number.isFinite(v) || v < 0 || v >= 1) return null;
    if (i > 0 && !(v > starts[i - 1]!)) return null;
  }
  return [...starts];
}

/** Index of the sector that contains `pct`. */
export function sectorIndexAt(starts: readonly number[], pct: number): number {
  let index = 0;
  for (let i = 1; i < starts.length; i++) if (pct >= starts[i]!) index = i;
  return index;
}

function sameStarts(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Times the official sectors of the player's laps. Sector times are differences of the lap's own
 * elapsed time at interpolated boundary crossings, so a sector is timed whenever both of its
 * boundaries were seen without a jump in between (also on a lap joined mid-way).
 * Driven by DeltaTracker, which owns the lap lifecycle.
 */
export class SectorTimer {
  private starts: number[] | null = null;
  private best: (number | null)[] = [];
  private lap: LapSectors | null = null;
  private finished: LapSectors | null = null;
  private open: { index: number; startS: number } | null = null;
  private prev: Sample | null = null;

  /** New track data; different starts forget everything (bests too). */
  setTrack(starts: readonly number[] | null): void {
    const valid = validSectorStarts(starts);
    if (sameStarts(valid, this.starts)) return;
    this.reset();
    this.starts = valid;
    this.best = valid === null ? [] : valid.map(() => null);
  }

  /** Session change: forget laps and bests (the track stays). */
  reset(): void {
    this.best = this.starts === null ? [] : this.starts.map(() => null);
    this.dropLap();
  }

  /** The lap in progress is no longer timed from the line (a jump in laps, a lap joined mid-way). */
  dropLap(): void {
    this.lap = null;
    this.finished = null;
    this.open = null;
    this.prev = null;
  }

  /** One tick inside a lap. */
  sample(
    pct: number | null,
    elapsedS: number,
    tickS: number,
    refs: readonly SectorReference[],
    clean: boolean,
  ): void {
    const starts = this.starts;
    if (starts === null) return;
    if (pct === null || !Number.isFinite(pct) || !Number.isFinite(elapsedS)) {
      this.open = null;
      this.prev = null;
      return;
    }
    const p = this.prev;
    const step = p === null ? 0 : pct - p.pct;
    if (p === null || step < -MAX_BACK || step > MAX_FORWARD) {
      // No previous point, or a jump: nothing open can be timed any more.
      if (p !== null) this.open = null;
      this.prev = { pct, elapsedS, tickS };
      return;
    }
    if (step <= 0) return; // standing still or a tiny step back: keep the last point
    for (let j = 1; j < starts.length; j++) {
      const b = starts[j]!;
      if (b > p.pct && b <= pct) {
        const t = p.elapsedS + ((b - p.pct) / step) * (Math.max(elapsedS, p.elapsedS) - p.elapsedS);
        this.cross(j, t, refs, clean);
      }
    }
    this.prev = { pct, elapsedS, tickS };
  }

  /**
   * The line was crossed at this tick (`pct` is the new lap's fraction, when known). Completes
   * the last sector by interpolating the crossing between the previous sample and this one, keeps
   * the lap for the lap-complete window and opens sector 1 of the new lap at elapsed 0.
   * Returns the finished lap's sectors (null when none was timed).
   */
  line(
    pct: number | null,
    tickS: number,
    refs: readonly SectorReference[],
    clean: boolean,
  ): LapSectors | null {
    const starts = this.starts;
    if (starts === null) return null;
    const p = this.prev;
    if (p !== null) {
      const after = pct !== null && Number.isFinite(pct) && pct < 0.5 ? pct : 0;
      const span = 1 - p.pct + after;
      const dt = Math.max(0, tickS - p.tickS);
      const timeAt = (to: number): number =>
        p.elapsedS + (span > 0 ? Math.min(1, Math.max(0, (to - p.pct) / span)) : 1) * dt;
      for (let j = 1; j < starts.length; j++) {
        if (starts[j]! > p.pct) this.cross(j, timeAt(starts[j]!), refs, clean);
      }
      this.cross(starts.length, timeAt(1), refs, clean);
    }
    const done = this.lap;
    if (done !== null) done.clean = clean;
    this.finished = done;
    this.lap = null;
    this.open = { index: 0, startS: 0 };
    this.prev = { pct: 0, elapsedS: 0, tickS };
    return done;
  }

  /** The finished lap's validity is known: a clean lap's sector times enter the session bests. */
  resolve(lap: LapSectors | null, clean: boolean): void {
    if (lap === null) return;
    lap.clean = clean;
    if (!clean || lap.times.length !== this.best.length) return;
    lap.times.forEach((t, i) => {
      const b = this.best[i] ?? null;
      if (t !== null && (b === null || t < b)) this.best[i] = t;
    });
  }

  /**
   * What to publish this tick. `showFinished`: the lap-complete window is still open, so the lap
   * just finished is shown unless a sector of the new lap has completed. `clean`: the lap in
   * progress is clean so far.
   */
  output(pct: number | null, showFinished: boolean, clean: boolean): SectorTiming | null {
    const starts = this.starts;
    if (starts === null) return null;
    if (!showFinished) this.finished = null;
    const shown = this.finished ?? this.lap;
    const shownClean = shown === this.lap ? clean : (shown?.clean ?? false);
    const n = starts.length;
    const times = shown === null ? new Array<number | null>(n).fill(null) : [...shown.times];
    const byReference = {} as Record<DeltaReferenceKind, SectorDeltas>;
    for (const kind of KINDS) {
      const deltas = shown?.deltas[kind] ?? new Array<number | null>(n).fill(null);
      const states = times.map((t, i): SectorState | null => {
        if (t === null) return null;
        if (shownClean && shown?.fastest[i] === true) return "best";
        const d = deltas[i] ?? null;
        if (d === null) return null;
        return d <= 0 ? "gain" : "loss";
      });
      byReference[kind] = { deltas: [...deltas], states };
    }
    const known = pct !== null && Number.isFinite(pct);
    return {
      startPcts: [...starts],
      current: known ? sectorIndexAt(starts, pct) : null,
      lapDistPct: known ? pct : null,
      times,
      byReference,
    };
  }

  /** Boundary `j` (the start of sector j; starts.length is the line) was passed at `t`. */
  private cross(j: number, t: number, refs: readonly SectorReference[], clean: boolean): void {
    const open = this.open;
    if (open !== null && open.index === j - 1)
      this.complete(open.index, t - open.startS, refs, clean);
    this.open = { index: j, startS: t };
  }

  private complete(
    i: number,
    time: number,
    refs: readonly SectorReference[],
    clean: boolean,
  ): void {
    const starts = this.starts!;
    const n = starts.length;
    if (!(time > 0)) return;
    if (this.lap === null) {
      this.lap = {
        times: new Array<number | null>(n).fill(null),
        deltas: {},
        fastest: new Array<boolean>(n).fill(false),
        clean,
      };
    }
    // A sector of the new lap is done: the finished lap is no longer shown.
    this.finished = null;
    const lap = this.lap;
    lap.times[i] = time;
    lap.clean = clean;
    const best = this.best[i] ?? null;
    lap.fastest[i] = best === null || time <= best + TIE_S;
    const from = starts[i]!;
    const to = i + 1 < n ? starts[i + 1]! : 1;
    for (const r of refs) {
      const refS = traceTimeAt(r.trace, r.lapTimeS, to) - traceTimeAt(r.trace, r.lapTimeS, from);
      const row = (lap.deltas[r.kind] ??= new Array<number | null>(n).fill(null));
      row[i] = time - refS;
    }
  }
}
