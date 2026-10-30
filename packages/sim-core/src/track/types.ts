/** Number of points in every outline: one per 0.1% of the lap. */
export const OUTLINE_POINTS = 1000;

export type OutlineSource = "integrated" | "world";

/**
 * The shape of one track layout, ready for a map overlay to place cars on by lapDistPct.
 *
 * Coordinates: `points` fit a unit box (the longer side spans 0..1, the shorter side is
 * centred), x to the right and y DOWN as on a screen, north up where the sim knows north. The
 * loop is closed implicitly: the last point joins the first. Point k sits at lapDistPct
 * k / points.length. `scaleM` is the metres one unit stands for.
 */
export interface TrackOutline {
  version: 1;
  trackKey: string;
  points: [number, number][];
  scaleM: number;
  /** Length of the closed polyline in metres. */
  lengthM: number;
  source: OutlineSource;
  /** How far the integrated path missed its start in metres, before it was corrected. */
  closureErrorM: number;
  /** ISO 8601 UTC. */
  createdAt: string;
}

/** What the builder needs from one telemetry tick of the player. */
export interface TrackSample {
  /** Sim clock in seconds. */
  tickS: number;
  lapDistPct: number;
  onPitRoad: boolean;
  /** False while the car is not in the world (garage, reset). */
  onTrack: boolean;
  /** Best lap of the session in seconds, when known; used for the 107% rule. */
  bestLapS: number | null;
  /** Heading in radians, clockwise from north (iRacing YawNorth); with `velocityMps`. */
  headingRad: number | null;
  /** Car-frame velocity: x forward, y to the left. */
  velocityMps: { x: number; y: number } | null;
  /** World position on the ground plane (LMU x/z); wins over heading and velocity. */
  worldPos: { x: number; z: number } | null;
}

export type RejectReason =
  | "incomplete"
  | "pit-road"
  | "off-track"
  | "tick-gap"
  | "not-monotonic"
  | "slow-lap"
  | "no-position"
  | "mixed-sources"
  | "closure"
  | "length-mismatch";

export type LapResult =
  { ok: true; outline: TrackOutline } | { ok: false; reason: RejectReason; detail?: string };

/** Where the tracker keeps outlines between runs; the telemetry process supplies the files. */
export interface TrackOutlineStore {
  /** Null when there is none or it cannot be read. */
  load(trackKey: string): TrackOutline | null;
  save(outline: TrackOutline): void;
}
