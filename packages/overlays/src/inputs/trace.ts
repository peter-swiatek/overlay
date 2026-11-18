export interface InputSample {
  /** Sim session time, s. */
  t: number;
  throttle: number; // 0..1
  brake: number; // 0..1
  clutch: number; // 0..1
  /** -1..1, positive right. */
  steer: number;
  abs: boolean;
}

export type TraceKey = "throttle" | "brake" | "clutch" | "steer";

/**
 * Keeps the samples of the last `windowS` seconds; drops everything when time goes back or
 * when a sample arrives more than `windowS` after the previous one (a gap in live data).
 * The backing array is reused and trimmed in place, so pushing at 60 Hz does not allocate a
 * new array per frame.
 */
export class InputTrace {
  private readonly list: InputSample[] = [];
  private windowS: number;

  constructor(windowS: number) {
    this.windowS = windowS;
  }

  push(sample: InputSample): void {
    const last = this.list[this.list.length - 1];
    if (last !== undefined && (sample.t < last.t || sample.t - last.t > this.windowS)) {
      this.list.length = 0;
    }
    this.list.push(sample);
    this.trim();
  }

  setWindow(windowS: number): void {
    this.windowS = windowS;
    this.trim();
  }

  get samples(): readonly InputSample[] {
    return this.list;
  }

  private trim(): void {
    const newest = this.list[this.list.length - 1];
    if (newest === undefined) return;
    const cutoff = newest.t - this.windowS;
    let drop = 0;
    // Keep one sample at or just outside the window so the line reaches the left edge.
    while (drop + 1 < this.list.length && (this.list[drop + 1] as InputSample).t <= cutoff) drop++;
    if (drop > 0) this.list.splice(0, drop);
  }
}

function value(sample: InputSample, key: TraceKey): number {
  return key === "steer" ? (sample.steer + 1) / 2 : sample[key];
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function point(
  sample: InputSample,
  key: TraceKey,
  nowS: number,
  windowS: number,
  width: number,
  height: number,
): string {
  const x = width - ((nowS - sample.t) / windowS) * width;
  const v = Math.min(1, Math.max(0, value(sample, key)));
  const y = 4 + (1 - v) * (height - 8);
  return `${fmt(x)},${fmt(y)}`;
}

/**
 * SVG polyline points: x by time across `width` (newest at the right edge),
 * y = 4 + (1 - v) * (height - 8). Steering maps -1..1 to 0..1.
 */
export function tracePoints(
  samples: readonly InputSample[],
  key: TraceKey,
  nowS: number,
  windowS: number,
  width: number,
  height: number,
): string {
  return samples.map((s) => point(s, key, nowS, windowS, width, height)).join(" ");
}

/**
 * Path "M x,y L ..." for each run of samples with abs true, joined to the neighbouring points
 * as the brake line.
 */
export function absPath(
  samples: readonly InputSample[],
  nowS: number,
  windowS: number,
  width: number,
  height: number,
): string {
  const parts: string[] = [];
  let i = 0;
  while (i < samples.length) {
    if (!(samples[i] as InputSample).abs) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < samples.length && (samples[end + 1] as InputSample).abs) end++;
    const from = Math.max(0, i - 1);
    const to = Math.min(samples.length - 1, end + 1);
    const pts: string[] = [];
    for (let k = from; k <= to; k++) {
      pts.push(point(samples[k] as InputSample, "brake", nowS, windowS, width, height));
    }
    parts.push(`M ${pts.join(" L ")}`);
    i = end + 1;
  }
  return parts.join(" ");
}
