import type { TelemetryFrame } from "@overlay/sim-core/types";
import type { Decimals } from "@overlay/ui/types";
import { driverRows, reuseRows, type DriverRow } from "../shared";

/*
 * Overtake Alert view model: cars of a faster class closing on the player from behind, so the
 * player knows who is about to come past.
 *
 * - Behind and how far: sim-core's relative gap (`derived.gaps`, positive = behind on track), the
 *   same number the Relative shows.
 * - Faster class: the class's best lap this session (`derived.standings.classBestLapS`, the
 *   fastest lap any car of that class has set), else the best of its cars' own best laps. A class
 *   is faster when its pace is below the player's class pace. A class without a lap yet is not
 *   counted as faster, so nothing shows until both classes have set a time.
 * - A single-class session shows nothing.
 */

/** The window's settings range and default, seconds behind. */
export const WINDOW_MIN_S = 2;
export const WINDOW_MAX_S = 10;
export const WINDOW_DEFAULT_S = 5;

export interface OvertakeOptions {
  /** Cars up to this many seconds behind are shown. */
  windowS: number;
  /** Most rows shown; the closest cars win. */
  maxRows: number;
  /** Also show cars of the player's own class. */
  includeSameClass: boolean;
  livePositions: boolean;
  gapDecimals: Decimals;
  lapDecimals: Decimals;
}

/** A driver row with what only the Overtake Alert shows. */
export interface OvertakeRow extends DriverRow {
  /** "+1.2s": seconds behind, one decimal. */
  gapText: string;
  /**
   * 0 at the far end of the window (spawns at the bottom), 1 at no gap (the top):
   * clamp((window - gap) / window, 0, 1) on the unrounded gap.
   */
  progress: number;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Fastest lap set by a class this session, seconds; null when the class has no lap yet. */
export function classPaceS(frame: TelemetryFrame, classKey: string): number | null {
  const best = finite(frame.derived.standings?.classBestLapS[classKey]);
  if (best !== null) return best;
  let pace: number | null = null;
  for (const car of frame.state.cars) {
    if (car.isPaceCar === true || (car.classId ?? "") !== classKey) continue;
    const lap = finite(car.bestLapS);
    if (lap !== null && (pace === null || lap < pace)) pace = lap;
  }
  return pace;
}

/** "+1.2s" */
export function gapText(gapS: number): string {
  return `+${gapS.toFixed(1)}s`;
}

/** clamp((window - gap) / window, 0, 1) */
export function gapProgress(gapS: number, windowS: number): number {
  if (!(windowS > 0)) return 0;
  return Math.min(1, Math.max(0, (windowS - gapS) / windowS));
}

function clampWindow(windowS: number): number {
  if (!Number.isFinite(windowS)) return WINDOW_DEFAULT_S;
  return Math.min(WINDOW_MAX_S, Math.max(WINDOW_MIN_S, windowS));
}

/**
 * The cars to warn about, closest first: connected, out of the pits, behind the player on track
 * within the window, and of a faster class (or the player's own, with the option). Empty without
 * a live frame or a player, while the player is on pit road, and in a single-class session.
 * `previous` keeps unchanged rows' identity.
 */
export function overtakeView(
  frame: TelemetryFrame | null,
  options: OvertakeOptions,
  previous: readonly OvertakeRow[] = [],
): OvertakeRow[] {
  if (frame === null || frame.status !== "live") return [];
  const playerIdx = frame.state.playerCarIdx;
  if (playerIdx === null) return [];
  const player = frame.state.cars.find((c) => c.carIdx === playerIdx);
  if (player === undefined || player.onPitRoad === true || player.inPitStall === true) return [];

  const playerClass = player.classId ?? "";
  const classes = new Set<string>();
  for (const car of frame.state.cars) if (car.isPaceCar !== true) classes.add(car.classId ?? "");
  if (classes.size < 2) return [];

  const playerPace = classPaceS(frame, playerClass);
  const faster = new Map<string, boolean>();
  const isFaster = (key: string): boolean => {
    let known = faster.get(key);
    if (known === undefined) {
      const pace = classPaceS(frame, key);
      known = pace !== null && playerPace !== null && pace < playerPace;
      faster.set(key, known);
    }
    return known;
  };

  const windowS = clampWindow(options.windowS);
  const raw = new Map<number, number>();
  for (const g of frame.derived.gaps) if (g.gapS !== null) raw.set(g.carIdx, g.gapS);
  const connected = new Set<number>();
  for (const car of frame.state.cars) if (car.connected) connected.add(car.carIdx);

  const found: { row: DriverRow; gap: number }[] = [];
  for (const row of driverRows(frame, options)) {
    if (row.carIdx === playerIdx || !connected.has(row.carIdx)) continue;
    if (row.onPitRoad || row.inPitStall) continue;
    const gap = raw.get(row.carIdx);
    if (gap === undefined || !Number.isFinite(gap) || gap <= 0 || gap > windowS) continue;
    const same = row.classKey === playerClass;
    if (same ? !options.includeSameClass : !isFaster(row.classKey)) continue;
    found.push({ row, gap });
  }
  found.sort((a, b) => a.gap - b.gap || a.row.carIdx - b.row.carIdx);
  const rows = found
    .slice(0, Math.max(0, Math.floor(options.maxRows)))
    .map(({ row, gap }): OvertakeRow => ({
      ...row,
      gapText: gapText(gap),
      progress: gapProgress(gap, windowS),
    }));
  return reuseRows(previous, rows);
}

/**
 * Where each row sits, as a CSS length from the top of the overlay (closest car first). A row's
 * own place is `(100cqh - rowHeight) * (1 - progress)`. Rows never overlap: a row below another
 * is pushed down to clear it, and every row stays high enough for the rows below it to fit.
 * In rows from the top, with H the height in rows and p the progress:
 *   top(i) = min(H - (n - i), max over j <= i of ((H - 1) * (1 - p(j)) + (i - j)))
 */
export function rowTops(progress: readonly number[], rowHeight: string): string[] {
  const n = progress.length;
  const span = `(100cqh - ${rowHeight})`;
  return progress.map((_, i) => {
    const own: string[] = [];
    for (let j = 0; j <= i; j++) {
      const free = round(1 - (progress[j] ?? 0));
      const below = i - j === 0 ? "" : ` + ${i - j} * ${rowHeight}`;
      own.push(`${span} * ${free}${below}`);
    }
    const reach = own.length === 1 ? `calc(${own[0]})` : `max(${own.join(", ")})`;
    return `min(calc(100cqh - ${n - i} * ${rowHeight}), ${reach})`;
  });
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Edit-mode sample, the design's two rows: Hypercars 1.2 s and 3.8 s behind a GT3 player. */
export function sampleOvertakeRows(windowS = WINDOW_DEFAULT_S): OvertakeRow[] {
  const sample = (
    carIdx: number,
    position: number,
    carNumber: string,
    driverName: string,
    iRating: number,
    gap: number,
  ): OvertakeRow => ({
    ...SAMPLE_ROW,
    carIdx,
    position,
    carNumber,
    driverName,
    iRating,
    relativeGapS: gap,
    gapText: gapText(gap),
    progress: gapProgress(gap, clampWindow(windowS)),
  });
  return [
    sample(9, 2, "10", "Nadia Quill", 2500, 1.2),
    sample(14, 3, "15", "Kasper Holm", 2700, 3.8),
  ];
}

const SAMPLE_ROW: DriverRow = {
  carIdx: 0,
  isFocus: false,
  driverName: null,
  teamName: null,
  carNumber: null,
  classKey: "2",
  className: "Hypercar",
  classColour: "#ff5888",
  position: null,
  overallPosition: null,
  licence: "A 3.00",
  iRating: null,
  iRatingChange: null,
  yellow: false,
  gapToLeader: null,
  gapToClassLeader: null,
  interval: null,
  relativeGapS: null,
  lastLapS: null,
  bestLapS: null,
  avgLapS: null,
  lastLapDeltaS: null,
  bestLapDeltaS: null,
  fastest: false,
  lap: null,
  onPitRoad: false,
  inPitStall: false,
  lastPitLap: null,
  stintLaps: null,
  prevStintLaps: null,
  positionsGained: null,
  energyFraction: null,
  p2pCount: null,
  p2pActive: false,
  badge: null,
  progressLaps: null,
};
