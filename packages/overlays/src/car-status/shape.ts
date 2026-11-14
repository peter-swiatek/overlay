import type { ZoneId } from "../vehicle-damage/view";
import type { CornerId } from "./view";

/**
 * The car from above in a 200 x 250 drawing, nose up and the car's left on the left. The body is
 * a ring of separate segments, each coloured by its dent zone; each wheel sits outside it as three
 * separate parts, from the body outward: the suspension chevron, the brake strip and the tyre.
 */
export const VIEW_W = 200;
export const VIEW_H = 250;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Mirror a path's x coordinates across the car's centre line. */
function mirror(points: readonly (readonly [number, number])[]): [number, number][] {
  return points.map(([x, y]) => [VIEW_W - x, y]);
}

function polygon(points: readonly (readonly [number, number])[]): string {
  return `M${points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(" L")} Z`;
}

/** A band between two circles around (cx, cy), from angle a0 to a1 (degrees, y down). */
function bandPoints(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  a0: number,
  a1: number,
): [number, number][] {
  const steps = 10;
  const at = (r: number, a: number): [number, number] => [
    cx + r * Math.cos((a * Math.PI) / 180),
    cy + r * Math.sin((a * Math.PI) / 180),
  ];
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) out.push(at(outer, a0 + ((a1 - a0) * i) / steps));
  for (let i = steps; i >= 0; i--) out.push(at(inner, a0 + ((a1 - a0) * i) / steps));
  return out;
}

/** Where the body's sides run: the outer edge of the side panels and the corner arcs. */
export const BODY_LEFT = 38;

const FRONT_ARC = bandPoints(74, 46, 27, 36, 190, 255);
const REAR_ARC = bandPoints(74, 204, 27, 36, 105, 170);
const SIDE: [number, number][] = [
  [BODY_LEFT, 98],
  [BODY_LEFT + 9, 106],
  [BODY_LEFT + 9, 144],
  [BODY_LEFT, 152],
];

/** The bodywork segments; the tail has two (bumper and diffuser), both in the rear zone. */
export const SEGMENTS: readonly { zone: ZoneId; d: string }[] = [
  // Nose bar: a slight trapezoid, wider at the top.
  {
    zone: "front",
    d: polygon([
      [76, 10],
      [100, 8],
      [124, 10],
      [120, 19],
      [100, 17.5],
      [80, 19],
    ]),
  },
  { zone: "frontLeft", d: polygon(FRONT_ARC) },
  { zone: "frontRight", d: polygon(mirror(FRONT_ARC)) },
  { zone: "left", d: polygon(SIDE) },
  { zone: "right", d: polygon(mirror(SIDE)) },
  { zone: "rearLeft", d: polygon(REAR_ARC) },
  { zone: "rearRight", d: polygon(mirror(REAR_ARC)) },
  // Rear bumper, then the wider, thinner diffuser below it.
  {
    zone: "rear",
    d: polygon([
      [80, 229],
      [120, 229],
      [124, 237],
      [76, 237],
    ]),
  },
  {
    zone: "rear",
    d: polygon([
      [44, 242],
      [156, 242],
      [150, 247],
      [50, 247],
    ]),
  },
];

/** The tyre's size, and how far the brake strip and chevron sit inboard of it. */
const TYRE_W = 28;
const TYRE_H = 52;
const TYRE_X = 1;
const BRAKE_GAP = 2;
const BRAKE_W = 4.5;
const BRAKE_INSET = 6;
const CHEV_GAP = 4.5;
const CHEV_W = 8;
const CHEV_H = 22;

export interface WheelShape {
  tyre: { x: number; y: number; width: number; height: number };
  brake: { x: number; y: number; width: number; height: number };
  /** The chevron, pointing at the car. */
  chevron: string;
}

function wheel(left: boolean, top: number): WheelShape {
  const tyreX = left ? TYRE_X : VIEW_W - TYRE_X - TYRE_W;
  const brakeX = left ? TYRE_X + TYRE_W + BRAKE_GAP : tyreX - BRAKE_GAP - BRAKE_W;
  const mid = top + TYRE_H / 2;
  const chevOuter = left ? brakeX + BRAKE_W + CHEV_GAP : brakeX - CHEV_GAP;
  const chevTip = left ? chevOuter + CHEV_W : chevOuter - CHEV_W;
  return {
    tyre: { x: tyreX, y: top, width: TYRE_W, height: TYRE_H },
    brake: { x: brakeX, y: top + BRAKE_INSET, width: BRAKE_W, height: TYRE_H - 2 * BRAKE_INSET },
    chevron: `M${chevOuter},${mid - CHEV_H / 2} L${chevTip},${mid} L${chevOuter},${mid + CHEV_H / 2}`,
  };
}

/** Front wheels beside the front of the body, rear ones beside the rear. */
export const WHEELS: Readonly<Record<CornerId, WheelShape>> = {
  fl: wheel(true, 40),
  fr: wheel(false, 40),
  rl: wheel(true, 156),
  rr: wheel(false, 156),
};
