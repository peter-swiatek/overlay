import { OUTLINE_POINTS, type TrackOutline } from "./types";

/**
 * Where a car at `lapDistPct` sits on the outline, in the unit box of `outline.points`.
 * The lap is a loop: 1 is the same place as 0, and values outside 0..1 wrap around.
 */
export function pointAtPct(outline: TrackOutline, lapDistPct: number): [number, number] {
  const pts = outline.points;
  const n = pts.length;
  const wrapped = ((lapDistPct % 1) + 1) % 1;
  const at = wrapped * n;
  const i = Math.min(Math.floor(at), n - 1);
  const f = at - i;
  const a = pts[i];
  const b = pts[(i + 1) % n];
  if (a === undefined || b === undefined) return [0, 0];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Length in the unit of the points of the closed polyline through them. */
export function closedLength(points: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a !== undefined && b !== undefined) total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

/** Signed area of a closed polyline; positive when it runs clockwise on a y-down screen. */
export function signedArea(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a !== undefined && b !== undefined) sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** Structural check for an outline read from a file or received over a port. */
export function isTrackOutline(value: unknown): value is TrackOutline {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (o["version"] !== 1 || typeof o["trackKey"] !== "string") return false;
  if (o["source"] !== "integrated" && o["source"] !== "world") return false;
  for (const key of ["scaleM", "lengthM", "closureErrorM"]) {
    if (typeof o[key] !== "number" || !Number.isFinite(o[key])) return false;
  }
  if (typeof o["createdAt"] !== "string") return false;
  const pts = o["points"];
  return (
    Array.isArray(pts) &&
    pts.length === OUTLINE_POINTS &&
    pts.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === "number" &&
        typeof p[1] === "number" &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]),
    )
  );
}
