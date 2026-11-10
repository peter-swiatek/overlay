import type { TelemetryFrame } from "@overlay/sim-core/types";
import { carLabel } from "../track-map/view";

export interface RadarOptions {
  /** Metres from the centre to the outer ring. */
  rangeM: number;
  carLengthM: number;
  carWidthM: number;
}

export interface RadarCar {
  carIdx: number;
  /** Metres to the right of the player's centre; negative = left. */
  x: number;
  /** Metres ahead of the player's centre; negative = behind. */
  y: number;
  /** Alongside (the spotter puts it on a side): drawn as a warning with a label. */
  alongside: boolean;
  /** Class colour as given by the sim; null when unknown. */
  colour: string | null;
  /** "4 (1.8m)": car number and the gap along the track, for a car alongside; null otherwise. */
  label: string | null;
}

export interface RadarView {
  /** Cars within range, furthest first so the nearest draws on top. */
  cars: RadarCar[];
  /** A car alongside on that side: the warning arc. */
  left: boolean;
  right: boolean;
}

interface RememberedSide {
  side: "left" | "right";
  lastSeenMs: number;
}

/**
 * iRacing gives no sideways positions, only the spotter call, so a car keeps the lane the call
 * gave it for a moment after the call ends; otherwise a car just past would jump into our lane.
 */
export interface RadarMemory {
  sides: Map<number, RememberedSide>;
}

export function newRadarMemory(): RadarMemory {
  return { sides: new Map() };
}

/** How long a car keeps its remembered lane (iRacing) once the spotter no longer calls it. */
export const SIDE_HOLD_MS = 1500;

/**
 * Without sideways positions (iRacing) a car on a side is drawn this far from our centre line:
 * one car width plus a gap, the usual spacing of two cars side by side.
 */
export function laneOffsetM(carWidthM: number): number {
  return round5cm(carWidthM * 1.6);
}

/** Rounded to 5 cm so a car creeping a centimetre does not re-render the overlay. */
function round5cm(n: number): number {
  return Math.round(n * 20) / 20;
}

/** Deterministic given its inputs; updates `memory` in place. Null when there is no proximity. */
export function radarView(
  frame: TelemetryFrame | null,
  memory: RadarMemory,
  nowMs: number,
  options: RadarOptions,
): RadarView | null {
  const prox = frame !== null && frame.status === "live" ? frame.derived.proximity : null;
  if (prox === null || frame === null) {
    memory.sides.clear();
    return null;
  }
  const lane = laneOffsetM(options.carWidthM);
  const byIdx = new Map(frame.state.cars.map((c) => [c.carIdx, c]));
  const cars: RadarCar[] = [];
  const seen = new Set<number>();
  for (const near of prox.nearby) {
    seen.add(near.carIdx);
    let x: number;
    if (near.lateralM !== null) {
      x = near.lateralM;
    } else {
      let side = near.side;
      if (side !== null) {
        memory.sides.set(near.carIdx, { side, lastSeenMs: nowMs });
      } else {
        const m = memory.sides.get(near.carIdx);
        if (m !== undefined && nowMs - m.lastSeenMs <= SIDE_HOLD_MS) side = m.side;
      }
      x = side === "left" ? -lane : side === "right" ? lane : 0;
    }
    const y = near.longitudinalM;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > options.rangeM) continue;
    const car = byIdx.get(near.carIdx);
    const alongside = near.side !== null;
    const number = carLabel(car?.carNumber ?? null);
    cars.push({
      carIdx: near.carIdx,
      x: round5cm(x),
      y: round5cm(y),
      alongside,
      colour: car?.classColour ?? null,
      label: alongside && number !== null ? `${number} (${Math.abs(y).toFixed(1)}m)` : null,
    });
  }
  for (const idx of memory.sides.keys()) if (!seen.has(idx)) memory.sides.delete(idx);
  cars.sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y) || a.carIdx - b.carIdx);
  return { cars, left: prox.left !== null, right: prox.right !== null };
}

/** Nothing to show: no car within range and no car alongside. */
export function radarClear(view: RadarView | null): boolean {
  return view === null || (view.cars.length === 0 && !view.left && !view.right);
}

// Drawing ----------------------------------------------------------------------------------------

/** SVG view box side; at the default size one unit is one pixel, like the design. */
export const VIEW = 220;
export const CENTRE = VIEW / 2;
/** Ring radii in view units: the outer ring is the range, then about 2/3 and 1/3 of it. */
export const RING_OUTER = 88;
export const RING_MIDDLE = 60;
export const RING_INNER = 32;
/** Warning arc: radius and the half-angle it spans either side of straight across. */
export const ARC_R = 68;
const ARC_HALF_DEG = 41.5;

/** View units per metre. */
export function radarScale(rangeM: number): number {
  return RING_OUTER / rangeM;
}

/** A car's rectangle in view units, centred on (x, y) metres. */
export function carRect(
  xM: number,
  yM: number,
  options: RadarOptions,
): { x: number; y: number; w: number; h: number; rx: number } {
  const s = radarScale(options.rangeM);
  const w = options.carWidthM * s;
  const h = options.carLengthM * s;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    x: r(CENTRE + xM * s - w / 2),
    y: r(CENTRE - yM * s - h / 2),
    w: r(w),
    h: r(h),
    rx: r(Math.min(w, h) * 0.25),
  };
}

/** The warning arc on one side: a circle segment centred on straight across. */
export function arcPath(side: "left" | "right"): string {
  const a = (ARC_HALF_DEG * Math.PI) / 180;
  const dx = Math.round(ARC_R * Math.cos(a) * 100) / 100;
  const dy = Math.round(ARC_R * Math.sin(a) * 100) / 100;
  const x = side === "right" ? CENTRE + dx : CENTRE - dx;
  const sweep = side === "right" ? 1 : 0;
  return `M ${x},${CENTRE - dy} A ${ARC_R},${ARC_R} 0 0,${sweep} ${x},${CENTRE + dy}`;
}

/** Class colour when it is a plain hex colour; otherwise null (the neutral car colour). */
export function classColourCss(colour: string | null): string | null {
  return colour !== null && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(colour)
    ? colour
    : null;
}

/** Edit-mode sample, as in the design: one car on the rear right, overlapping. */
export const EDIT_SAMPLE: RadarView = {
  cars: [
    { carIdx: 1, x: 0.3, y: 14, alongside: false, colour: null, label: null },
    { carIdx: 4, x: 3.05, y: -1.8, alongside: true, colour: null, label: "4 (1.8m)" },
  ],
  left: false,
  right: true,
};
