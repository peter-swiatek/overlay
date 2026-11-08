import type { Corner, TrackOutline } from "@overlay/sim-core/types";
import type { TrackMapData } from "../runtime";
import type { MapCar } from "./view";

/** Number of points of a real outline (sim-core OUTLINE_POINTS); the sample uses the same. */
const POINTS = 1000;

/**
 * Control points of an invented circuit, y down, driven in this order from the start/finish line
 * on the bottom straight. `corner` marks the ones that get a corner label.
 */
const CONTROL: readonly { x: number; y: number; corner?: true }[] = [
  { x: 0.45, y: 0.86 },
  { x: 0.78, y: 0.86 },
  { x: 0.92, y: 0.78, corner: true },
  { x: 0.9, y: 0.62 },
  { x: 0.74, y: 0.52, corner: true },
  { x: 0.7, y: 0.36 },
  { x: 0.82, y: 0.22, corner: true },
  { x: 0.7, y: 0.1 },
  { x: 0.48, y: 0.12, corner: true },
  { x: 0.36, y: 0.26, corner: true },
  { x: 0.22, y: 0.3 },
  { x: 0.1, y: 0.42, corner: true },
  { x: 0.08, y: 0.66 },
  { x: 0.16, y: 0.84, corner: true },
  { x: 0.28, y: 0.87 },
];

type Pt = [number, number];

function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** Builds the sample: a smooth closed loop through CONTROL, resampled to POINTS equal steps. */
function buildSample(): TrackMapData {
  const ctrl: Pt[] = CONTROL.map((c) => [c.x, c.y]);
  const n = ctrl.length;
  const at = (i: number): Pt => ctrl[((i % n) + n) % n]!;
  const STEPS = 60;
  const dense: Pt[] = [];
  const controlIndex: number[] = [];
  for (let i = 0; i < n; i++) {
    controlIndex.push(dense.length);
    for (let s = 0; s < STEPS; s++) {
      dense.push(catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), s / STEPS));
    }
  }
  // Cumulative length along the closed dense path.
  const cum: number[] = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i % dense.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[dense.length]!;
  const points: Pt[] = [];
  let j = 0;
  for (let k = 0; k < POINTS; k++) {
    const d = (k / POINTS) * total;
    while (cum[j + 1]! < d) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % dense.length]!;
    const f = (d - cum[j]!) / (cum[j + 1]! - cum[j]! || 1);
    points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  // Fit the unit box: the longer side spans 0..1, the shorter is centred.
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  const span = Math.max(w, h);
  const unit: Pt[] = points.map((p) => [
    (p[0] - minX) / span + (1 - w / span) / 2,
    (p[1] - minY) / span + (1 - h / span) / 2,
  ]);
  const corners: Corner[] = [];
  CONTROL.forEach((c, i) => {
    if (c.corner !== true) return;
    const pct = cum[controlIndex[i]!]! / total;
    corners.push({ number: corners.length + 1, startPct: pct - 0.01, endPct: pct + 0.01 });
  });
  const lengthM = 4000;
  const outline: TrackOutline = {
    version: 1,
    trackKey: "sample",
    points: unit,
    scaleM: (lengthM / total) * span,
    lengthM,
    source: "integrated",
    closureErrorM: 0,
    gapPct: 0,
    bridgeM: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return { outline, corners };
}

/** The invented track drawn in edit mode before the real outline is known. */
export const SAMPLE_TRACK: TrackMapData = buildSample();

export const SAMPLE_SECTOR_STARTS: readonly number[] = [0, 0.34, 0.67];

/** Cars on the sample track: two classes, one in the pit lane, one slow, and the player. */
export const SAMPLE_CARS: readonly MapCar[] = [
  { carIdx: 1, pct: 0.06, label: "7", colour: "#ffda59", pit: false, slow: false, player: false },
  { carIdx: 2, pct: 0.19, label: "22", colour: "#ffda59", pit: false, slow: false, player: false },
  { carIdx: 3, pct: 0.31, label: "48", colour: "#33ceff", pit: false, slow: false, player: false },
  { carIdx: 4, pct: 0.47, label: "3", colour: "#33ceff", pit: false, slow: true, player: false },
  { carIdx: 5, pct: 0.62, label: "15", colour: "#ffda59", pit: false, slow: false, player: false },
  { carIdx: 6, pct: 0.78, label: "91", colour: "#33ceff", pit: false, slow: false, player: false },
  { carIdx: 7, pct: 0.95, label: "64", colour: "#ffda59", pit: true, slow: false, player: false },
  { carIdx: 0, pct: 0.86, label: "1", colour: "#ffda59", pit: false, slow: false, player: true },
];

/** For hosts without outline fetching (the settings preview): always the sample track. */
export function useSampleTrack(): TrackMapData {
  return SAMPLE_TRACK;
}
