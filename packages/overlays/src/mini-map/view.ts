import type { TelemetryFrame, TrackOutline } from "@overlay/sim-core/types";
import { formatDelta } from "@overlay/ui/format";
import { threatLevel } from "../relative/view";
import { carLabel } from "../track-map/view";

/** The drawing's coordinate box (square); the SVG scales it into the window. */
export const VIEW = 220;
/** Centre of the range rings. */
export const CENTRE = VIEW / 2;
/** The player sits a little below the centre so more of the road ahead shows. */
export const PLAYER_X = CENTRE;
export const PLAYER_Y = CENTRE + 15;
export const RING_OUTER = 96;
export const RING_INNER = 55;
/** Outer ring distance in metres at 100 % zoom; 150 % shows 200 m, 300 % shows 100 m. */
export const BASE_RANGE_M = 300;
/** Road drawn this many outer-ring distances around the player: enough to reach the corners. */
const CROP_RANGES = 2;
/** Half the stretch of road the heading is measured over, in metres. */
const TANGENT_HALF_M = 20;
/** Gap between a dot's centre and its label. */
const LABEL_DX = 11;
/** Labels stay below the header line. */
const LABEL_MIN_Y = 30;

export type CarStatus = "off" | "slow" | "pit";

/** One other car, as the selector reads it from the frame. */
export interface MiniCar {
  carIdx: number;
  /** Lap-distance fraction 0..1. */
  pct: number;
  /** Car number without any "#"; null when unknown. */
  number: string | null;
  /** Class colour as given by the sim; null when unknown. */
  colour: string | null;
  status: CarStatus | null;
  /** Seconds to the player, rounded to 0.1; negative = ahead. Null when unknown. */
  gapS: number | null;
  /** Behind and within the Relative overlay's red gap-threat window. */
  threat: boolean;
}

export interface MiniLive {
  trackKey: string | null;
  outlineReady: boolean;
  /** The player's lap-distance fraction; null when the player is not on the map. */
  playerPct: number | null;
  cars: MiniCar[];
}

const NO_LIVE: MiniLive = { trackKey: null, outlineReady: false, playerPct: null, cars: [] };

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Telemetry selector: the player's place on the lap and every other car in the world. */
export function miniLive(frame: TelemetryFrame | null): MiniLive {
  if (frame === null || frame.status !== "live") return NO_LIVE;
  const { state, derived } = frame;
  const slowIdx = derived.slowCar?.carIdx ?? null;
  const gaps = new Map<number, number | null>();
  for (const g of derived.gaps) gaps.set(g.carIdx, g.gapS);
  let playerPct: number | null = null;
  const cars: MiniCar[] = [];
  for (const car of state.cars) {
    if (car.isPaceCar === true || car.lapDistPct === null || !Number.isFinite(car.lapDistPct)) {
      continue;
    }
    if (car.isOnTrack === false || car.trackSurface === "notInWorld") continue;
    // 0.0001 of a lap is well under a pixel even at full zoom on a short track.
    const pct = Math.round(car.lapDistPct * 10000) / 10000;
    if (car.carIdx === state.playerCarIdx) {
      playerPct = pct;
      continue;
    }
    const pit = car.onPitRoad === true || car.trackSurface === "inPitStall";
    const status: CarStatus | null = pit
      ? "pit"
      : car.trackSurface === "offTrack"
        ? "off"
        : car.carIdx === slowIdx
          ? "slow"
          : null;
    const raw = gaps.get(car.carIdx) ?? null;
    const gapS = raw === null || !Number.isFinite(raw) ? null : r1(raw);
    cars.push({
      carIdx: car.carIdx,
      pct,
      number: carLabel(car.carNumber),
      colour: car.classColour,
      status,
      gapS,
      // Same rule as the Relative overlay: a car behind (raw gap >= 0) within the red window.
      threat: raw !== null && raw >= 0 && gapS !== null && threatLevel(gapS) === "red",
    });
  }
  return {
    trackKey: derived.track.trackKey,
    outlineReady: derived.track.outlineReady,
    playerPct,
    cars,
  };
}

type Pt = [number, number];

/** Where a lap position sits on the outline, in the outline's unit box (the lap wraps). */
export function outlinePoint(outline: TrackOutline, pct: number): Pt {
  const pts = outline.points;
  const n = pts.length;
  if (n === 0) return [0, 0];
  const at = (((pct % 1) + 1) % 1) * n;
  const i = Math.min(Math.floor(at), n - 1);
  const f = at - i;
  const a = pts[i]!;
  const b = pts[(i + 1) % n]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/**
 * The direction of travel at `pct` as a unit vector in outline coordinates (y down), from the
 * outline's tangent over a short stretch either side. Works the same in every sim: it needs no
 * heading from the sim, only the learned outline. Straight up when the outline is degenerate.
 */
export function headingAt(outline: TrackOutline, pct: number): Pt {
  const lengthM = outline.lengthM > 0 ? outline.lengthM : 1;
  const half = Math.min(0.05, TANGENT_HALF_M / lengthM);
  const a = outlinePoint(outline, pct - half);
  const b = outlinePoint(outline, pct + half);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? [0, -1] : [dx / len, dy / len];
}

export interface MiniOptions {
  /** 100..300 (%). */
  zoomPct: number;
  headingUp: boolean;
  labels: boolean;
  gaps: boolean;
}

/** Outer-ring distance in metres for a zoom. */
export function rangeForZoom(zoomPct: number): number {
  return BASE_RANGE_M / (Math.max(1, zoomPct) / 100);
}

/** Outline unit-box coordinates to view coordinates, around the player. */
export interface MiniFrame {
  origin: Pt;
  /** Unit vector the view's "up" points along, in outline coordinates. */
  forward: Pt;
  /** View units per outline unit. */
  scale: number;
}

export function miniFrame(
  outline: TrackOutline,
  playerPct: number,
  options: Pick<MiniOptions, "zoomPct" | "headingUp">,
): MiniFrame {
  const pxPerM = RING_OUTER / rangeForZoom(options.zoomPct);
  return {
    origin: outlinePoint(outline, playerPct),
    forward: options.headingUp ? headingAt(outline, playerPct) : [0, -1],
    scale: outline.scaleM * pxPerM,
  };
}

/**
 * Rotates so `forward` points up and scales into view units, the player at (PLAYER_X, PLAYER_Y).
 * Right of the direction of travel is (-fy, fx) on a y-down plane: a rotation, never a mirror.
 */
export function toView(frame: MiniFrame, p: Pt): Pt {
  const dx = (p[0] - frame.origin[0]) * frame.scale;
  const dy = (p[1] - frame.origin[1]) * frame.scale;
  const [fx, fy] = frame.forward;
  const right = dx * -fy + dy * fx;
  const ahead = dx * fx + dy * fy;
  return [PLAYER_X + right, PLAYER_Y - ahead];
}

/**
 * The road near the player as an SVG path: only outline points within reach of the view, so a
 * far part of the lap is not drawn. Each stretch starts and ends one point outside the reach so
 * it runs off the edge; the whole loop closes when all of it is in reach.
 */
export function roadPath(outline: TrackOutline, frame: MiniFrame): string {
  const pts = outline.points;
  const n = pts.length;
  if (n < 2) return "";
  const reach = RING_OUTER * CROP_RANGES;
  const view = pts.map((p) => toView(frame, p));
  const inside = view.map(([x, y]) => Math.hypot(x - PLAYER_X, y - PLAYER_Y) <= reach);
  const fmt = ([x, y]: Pt): string => `${r1(x)} ${r1(y)}`;
  const start = inside.indexOf(false);
  if (start === -1) {
    return `${view.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p)}`).join("")}Z`;
  }
  const parts: string[] = [];
  let open = false;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    const prev = (i - 1 + n) % n;
    if (inside[i]) {
      parts.push(open ? `L${fmt(view[i]!)}` : `M${fmt(view[prev]!)}L${fmt(view[i]!)}`);
      open = true;
    } else if (open) {
      parts.push(`L${fmt(view[i]!)}`);
      open = false;
    }
  }
  return parts.join("");
}

export interface PlacedMiniCar extends MiniCar {
  x: number;
  y: number;
  /** Null when labels are off or there is nothing to say. */
  label: string | null;
  labelX: number;
  labelY: number;
  anchor: "start" | "end";
}

const STATUS_TEXT: Record<CarStatus, string> = { off: "OFF", slow: "SLOW", pit: "PIT" };

/** "4 (+0.8s)", "3 OFF (-2.5s)", "12 PIT"; null when there is nothing to show. */
export function miniLabel(car: MiniCar, gaps: boolean): string | null {
  const head = [car.number, car.status === null ? null : STATUS_TEXT[car.status]]
    .filter((s): s is string => s !== null)
    .join(" ");
  const gap = gaps && car.gapS !== null ? `(${formatDelta(car.gapS, 1)}s)` : null;
  const text = [head === "" ? null : head, gap].filter((s): s is string => s !== null).join(" ");
  return text === "" ? null : text;
}

/** Cars inside the view, with their labels; pit cars first so the field draws over them. */
export function placeMiniCars(
  outline: TrackOutline,
  frame: MiniFrame,
  cars: readonly MiniCar[],
  options: Pick<MiniOptions, "labels" | "gaps">,
): PlacedMiniCar[] {
  const placed: PlacedMiniCar[] = [];
  for (const car of cars) {
    const [x, y] = toView(frame, outlinePoint(outline, car.pct));
    if (x < -6 || x > VIEW + 6 || y < -6 || y > VIEW + 6) continue;
    // Labels run away from the right edge so they stay in the panel.
    const anchor = x > CENTRE + 30 ? "end" : "start";
    placed.push({
      ...car,
      x: r1(x),
      y: r1(y),
      label: options.labels ? miniLabel(car, options.gaps) : null,
      labelX: r1(anchor === "start" ? x + LABEL_DX : x - LABEL_DX),
      labelY: r1(Math.min(VIEW - 4, Math.max(LABEL_MIN_Y, y + 3.5))),
      anchor,
    });
  }
  const rank = (c: MiniCar): number => (c.status === "pit" ? 0 : c.status === null ? 1 : 2);
  return placed
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

/** "ZOOM 150% · HEADING UP". */
export function headerText(options: Pick<MiniOptions, "zoomPct" | "headingUp">): string {
  return `ZOOM ${Math.round(options.zoomPct)}% · ${options.headingUp ? "HEADING UP" : "NORTH UP"}`;
}

/** Edit-mode sample around the player on the Track Map's sample track (4 km, 0.01 = 40 m). */
export const SAMPLE_PLAYER_PCT = 0.3;
export const SAMPLE_MINI_CARS: readonly MiniCar[] = [
  {
    carIdx: 3,
    pct: 0.33,
    number: "3",
    colour: "#33ceff",
    status: "off",
    gapS: -2.5,
    threat: false,
  },
  { carIdx: 4, pct: 0.29, number: "4", colour: "#ffda59", status: null, gapS: 0.8, threat: true },
  {
    carIdx: 10,
    pct: 0.282,
    number: "10",
    colour: "#ff5c8a",
    status: null,
    gapS: 1.4,
    threat: false,
  },
];
