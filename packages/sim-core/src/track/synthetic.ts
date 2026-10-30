import { OUTLINE_POINTS, type TrackOutline, type TrackSample } from "./types";

/** A point on a closed test course, in metres: east and north. */
export type CoursePoint = (u: number) => { east: number; north: number };

export interface LapOptions {
  /** Samples per lap. */
  samples?: number;
  /** Seconds the lap takes. */
  lapS?: number;
  /** First sample's lap fraction; the lap runs from there to just before 1. */
  from?: number;
  startTickS?: number;
  /** Heading error in radians that grows linearly over the lap, giving the path drift. */
  headingDriftRad?: number;
  source?: "integrated" | "world";
  bestLapS?: number | null;
}

/** A circle of `radiusM`, driven clockwise from its northmost point. */
export function circle(radiusM: number): CoursePoint {
  return (u) => ({
    east: radiusM * Math.sin(2 * Math.PI * u),
    north: radiusM * Math.cos(2 * Math.PI * u),
  });
}

/** A figure of eight (Gerono lemniscate), width 2 * `sizeM`, which crosses itself once. */
export function figureEight(sizeM: number): CoursePoint {
  return (u) => {
    const t = 2 * Math.PI * u;
    return { east: sizeM * Math.sin(t), north: sizeM * Math.sin(t) * Math.cos(t) };
  };
}

/**
 * Samples of one lap along `course`: lapDistPct is the fraction of the lap time, which is also
 * how the course is parameterised, so the speed varies along it. Integrated samples carry the
 * heading and the speed as car-frame velocity; world samples carry the position (z is north).
 */
export function lapSamples(course: CoursePoint, options: LapOptions = {}): TrackSample[] {
  const n = options.samples ?? 6000;
  const lapS = options.lapS ?? 100;
  const from = options.from ?? 0.0005;
  const t0 = options.startTickS ?? 0;
  const eps = 1e-5;
  const out: TrackSample[] = [];
  for (let i = 0; i < n; i++) {
    const u = from + ((1 - from - 0.0005) * i) / (n - 1);
    const p = course(u);
    const a = course(u + eps);
    const b = course(u - eps);
    const vEast = (a.east - b.east) / (2 * eps * lapS);
    const vNorth = (a.north - b.north) / (2 * eps * lapS);
    const base = {
      tickS: t0 + (u - from) * lapS,
      lapDistPct: u,
      onPitRoad: false,
      onTrack: true,
      bestLapS: options.bestLapS ?? null,
      incidentCount: null,
    };
    if (options.source === "world") {
      out.push({
        ...base,
        headingRad: null,
        velocityMps: null,
        worldPos: { x: p.east, z: p.north },
      });
    } else {
      out.push({
        ...base,
        headingRad: Math.atan2(vEast, vNorth) + (options.headingDriftRad ?? 0) * u,
        velocityMps: { x: Math.hypot(vEast, vNorth), y: 0 },
        worldPos: null,
      });
    }
  }
  return out;
}

/** A square lap with 250 points per side, corners at pct 0, 0.25, 0.5 and 0.75. */
export function squareOutline(): TrackOutline {
  const points: [number, number][] = [];
  const side = OUTLINE_POINTS / 4;
  for (let i = 0; i < OUTLINE_POINTS; i++) {
    const edge = Math.floor(i / side);
    const f = (i % side) / side;
    if (edge === 0) points.push([f, 0]);
    else if (edge === 1) points.push([1, f]);
    else if (edge === 2) points.push([1 - f, 1]);
    else points.push([0, 1 - f]);
  }
  return {
    version: 1,
    trackKey: "test_square",
    points,
    scaleM: 1000,
    lengthM: 4000,
    source: "world",
    closureErrorM: 0,
    gapPct: 0,
    bridgeM: 0,
    createdAt: "2026-10-30T12:00:00.000Z",
  };
}
