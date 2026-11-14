/** Radius and stroke of the gear hub's input ring, px (viewBox 136). */
export const RING_RADIUS = 63;
export const RING_STROKE = 8;
/** Circumference of the ring, px. */
export const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Angle the round caps stick out beyond the dash at each end: half the stroke, as degrees of the ring. */
const CAP_DEG = ((RING_STROKE / 2 / RING_RADIUS) * 180) / Math.PI;
/** At or above this span the arc is a full circle. */
const FULL_DEG = 359.9;

export interface RingArc {
  show: boolean;
  /** `stroke-dasharray`: the dash and a gap longer than the rest of the circle. */
  dasharray: string;
  /** `rotate()` of the circle (SVG circles start at 3 o'clock, so this includes the -90 turn). */
  rotateDeg: number;
  cap: "round" | "butt";
}

/**
 * Ring arc on r = 63, stroke 8, as SVG dash settings. `fromDeg` is where the arc starts, clockwise
 * from 12 o'clock; `spanDeg` is how far it runs clockwise (0..360). Throttle is
 * `ringArc(0, 360 * t)`, brake `ringArc(-360 * b, 360 * b)` (anticlockwise from 12). Round caps
 * stay inside the span (the dash is shortened by the cap at each end, so an arc too short to hold
 * both caps is hidden); a full circle uses butt caps.
 */
export function ringArc(fromDeg: number, spanDeg: number): RingArc {
  const span = Number.isFinite(spanDeg) ? Math.min(360, Math.max(0, spanDeg)) : 0;
  const from = Number.isFinite(fromDeg) ? fromDeg : 0;
  const hidden: RingArc = { show: false, dasharray: "0 0", rotateDeg: from - 90, cap: "butt" };
  if (span <= 0) return hidden;
  if (span >= FULL_DEG) {
    const c = RING_LENGTH.toFixed(2);
    return { show: true, dasharray: `${c} ${c}`, rotateDeg: from - 90, cap: "butt" };
  }
  if (span <= 2 * CAP_DEG) return hidden;
  const dash = ((span - 2 * CAP_DEG) / 360) * RING_LENGTH;
  return {
    show: true,
    dasharray: `${dash.toFixed(2)} ${RING_LENGTH.toFixed(2)}`,
    rotateDeg: from - 90 + CAP_DEG,
    cap: "round",
  };
}
