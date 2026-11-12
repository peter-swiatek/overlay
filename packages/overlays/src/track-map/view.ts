import type { Corner, TelemetryFrame, TrackOutline } from "@overlay/sim-core/types";
import { lapStatuses, type LapStatus } from "../shared/laps";

/** The drawing's coordinate box; the SVG scales it into the window. */
export const VIEW_W = 320;
export const VIEW_H = 240;
/** Room around the ribbon for car labels, corner labels and the casing. */
export const MAP_MARGIN = 18;
/** Extra room under the ribbon for the edit-mode note. */
export const NOTE_RESERVE = 14;
/** Half the length of the start/finish and sector ticks. */
export const TICK_HALF = 7;
/** How far a corner label sits outside the ribbon. */
export const CORNER_LABEL_OFFSET = 13;

/** One car to place on the map. */
export interface MapCar {
  carIdx: number;
  /** Lap-distance fraction 0..1. */
  pct: number;
  /** Car number without any "#"; null when unknown. */
  label: string | null;
  /** Class colour "#rrggbb", null when unknown. */
  colour: string | null;
  /** In the pit lane or stall: drawn dimmed. */
  pit: boolean;
  /** The slow or stopped car the deriver reports ahead of the player. */
  slow: boolean;
  player: boolean;
  /** Races only: "ahead" = it has lapped or is lapping the player, "behind" = the reverse. */
  lap: LapStatus;
}

/** What the overlay reads from each frame. */
export interface MapLive {
  trackKey: string | null;
  outlineReady: boolean;
  sectorStartPcts: readonly number[] | null;
  cars: MapCar[];
}

const NO_LIVE: MapLive = { trackKey: null, outlineReady: false, sectorStartPcts: null, cars: [] };

/** "#7", "  12 " → "7", "12"; empty → null. Car numbers are always shown without a "#". */
export function carLabel(number: string | null): string | null {
  if (number === null) return null;
  const s = number.trim().replace(/^#+/, "").trim();
  return s === "" ? null : s;
}

/** Telemetry selector: the track key, the sector lines and every car that is in the world. */
export function mapLive(frame: TelemetryFrame | null): MapLive {
  if (frame === null || frame.status !== "live") return NO_LIVE;
  const { state, derived } = frame;
  const slowIdx = derived.slowCar?.carIdx ?? null;
  const laps = lapStatuses(frame);
  const cars: MapCar[] = [];
  for (const car of state.cars) {
    if (car.isPaceCar === true || car.lapDistPct === null || !Number.isFinite(car.lapDistPct)) {
      continue;
    }
    if (car.isOnTrack === false || car.trackSurface === "notInWorld") continue;
    const pit = car.onPitRoad === true || car.trackSurface === "inPitStall";
    cars.push({
      carIdx: car.carIdx,
      // Rounded so tiny moves do not re-render: 0.0001 of a lap is well under a pixel.
      pct: Math.round(car.lapDistPct * 10000) / 10000,
      label: carLabel(car.carNumber),
      colour: car.classColour,
      pit,
      slow: !pit && car.carIdx === slowIdx,
      player: car.carIdx === state.playerCarIdx,
      lap: car.carIdx === state.playerCarIdx ? null : (laps.get(car.carIdx) ?? null),
    });
  }
  return {
    trackKey: derived.track.trackKey,
    outlineReady: derived.track.outlineReady,
    sectorStartPcts: state.session.sectorStartPcts,
    cars,
  };
}

type Pt = [number, number];

/** Where an outline point lands in the view box. */
export interface MapFit {
  scale: number;
  dx: number;
  dy: number;
}

/** Fits the outline's bounding box into the view box less the margins, centred. */
export function fitOutline(points: readonly Pt[], bottomReserve = 0): MapFit {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const boxW = VIEW_W - 2 * MAP_MARGIN;
  const boxH = VIEW_H - 2 * MAP_MARGIN - bottomReserve;
  const scale = Math.min(boxW / w, boxH / h);
  return {
    scale,
    dx: MAP_MARGIN + (boxW - w * scale) / 2 - minX * scale,
    dy: MAP_MARGIN + (boxH - h * scale) / 2 - minY * scale,
  };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The outline fitted to the view box: the ribbon path and its centroid. */
export interface MapShape {
  outline: TrackOutline;
  fit: MapFit;
  /** Closed SVG path through every point. */
  path: string;
  centroid: Pt;
}

export function mapShape(outline: TrackOutline, bottomReserve = 0): MapShape {
  const fit = fitOutline(outline.points, bottomReserve);
  let cx = 0;
  let cy = 0;
  const parts: string[] = [];
  outline.points.forEach(([x, y], i) => {
    const sx = x * fit.scale + fit.dx;
    const sy = y * fit.scale + fit.dy;
    cx += sx;
    cy += sy;
    parts.push(`${i === 0 ? "M" : "L"}${r1(sx)} ${r1(sy)}`);
  });
  const n = Math.max(1, outline.points.length);
  return { outline, fit, path: `${parts.join("")}Z`, centroid: [cx / n, cy / n] };
}

/** Lap position to view-box point (the outline is a loop; pct wraps). */
export function placeAt(shape: MapShape, pct: number): Pt {
  const pts = shape.outline.points;
  const n = pts.length;
  if (n === 0) return [VIEW_W / 2, VIEW_H / 2];
  const wrapped = ((pct % 1) + 1) % 1;
  const at = wrapped * n;
  const i = Math.min(Math.floor(at), n - 1);
  const f = at - i;
  const a = pts[i]!;
  const b = pts[(i + 1) % n]!;
  const x = a[0] + (b[0] - a[0]) * f;
  const y = a[1] + (b[1] - a[1]) * f;
  return [x * shape.fit.scale + shape.fit.dx, y * shape.fit.scale + shape.fit.dy];
}

export interface Tick {
  kind: "start" | "sector";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A short line across the ribbon at `pct`, perpendicular to the direction of travel. */
export function tickAt(shape: MapShape, pct: number, kind: Tick["kind"]): Tick {
  const [x, y] = placeAt(shape, pct);
  const [ax, ay] = placeAt(shape, pct - 0.003);
  const [bx, by] = placeAt(shape, pct + 0.003);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  // Normal of the tangent.
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  return {
    kind,
    x1: r1(x - nx * TICK_HALF),
    y1: r1(y - ny * TICK_HALF),
    x2: r1(x + nx * TICK_HALF),
    y2: r1(y + ny * TICK_HALF),
  };
}

/** The start/finish line first, then one tick per sector start other than 0. */
export function mapTicks(shape: MapShape, sectorStartPcts: readonly number[] | null): Tick[] {
  const ticks = [tickAt(shape, 0, "start")];
  for (const pct of sectorStartPcts ?? []) {
    const p = ((pct % 1) + 1) % 1;
    if (!Number.isFinite(p) || p < 1e-6 || p > 1 - 1e-6) continue;
    ticks.push(tickAt(shape, p, "sector"));
  }
  return ticks;
}

export interface CornerLabel {
  text: string;
  x: number;
  y: number;
}

/** Middle of a corner's stretch; a corner across the line has endPct < startPct. */
export function cornerMidPct(c: Corner): number {
  const span = (((c.endPct - c.startPct) % 1) + 1) % 1;
  return (c.startPct + span / 2) % 1;
}

/**
 * One label per corner ("T" and its number in our list), pushed outward from the ribbon
 * (away from the outline's centroid).
 */
export function cornerLabels(shape: MapShape, corners: readonly Corner[]): CornerLabel[] {
  return corners.map((c) => {
    const [x, y] = placeAt(shape, cornerMidPct(c));
    const vx = x - shape.centroid[0];
    const vy = y - shape.centroid[1];
    const len = Math.hypot(vx, vy) || 1;
    return {
      text: `T${c.number}`,
      x: r1(x + (vx / len) * CORNER_LABEL_OFFSET),
      y: r1(y + (vy / len) * CORNER_LABEL_OFFSET),
    };
  });
}

export interface PlacedCar extends MapCar {
  x: number;
  y: number;
}

/** Draw order: pit cars at the back, then the field, the slow car, and the player on top. */
export function placeCars(shape: MapShape, cars: readonly MapCar[]): PlacedCar[] {
  const rank = (c: MapCar): number => (c.player ? 3 : c.slow ? 2 : c.pit ? 0 : 1);
  return cars
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => {
      const [x, y] = placeAt(shape, c.pct);
      return { ...c, x: r1(x), y: r1(y) };
    });
}

/** A class colour as a CSS value: "#rgb"/"#rrggbb"(aa) as given, anything else the accent. */
export function dotColour(colour: string | null): string {
  return colour !== null && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(colour)
    ? colour
    : "var(--ov-accent)";
}
