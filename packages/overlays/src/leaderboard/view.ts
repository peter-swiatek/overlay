import type { TelemetryFrame } from "@overlay/sim-core/types";
import type { Decimals } from "@overlay/ui/types";
import { driverRows, reuseRows, type DriverRow } from "../shared";

export interface DriversAround {
  showAll: boolean;
  around: number;
  topMyClass: number;
  topOtherClasses: number;
}

export interface LeaderboardSection {
  key: string;
  /** Class name ("Class" when unknown); "" in a single-class session. */
  label: string;
  colour: string | null;
  /** Cars in the class before "Drivers around" filtering. */
  total: number;
  rows: DriverRow[];
}

export interface LeaderboardView {
  /** One section per class in multi-class sessions, ordered by the overall position of each class leader; one unlabelled section otherwise. */
  sections: LeaderboardSection[];
  multiClass: boolean;
  /** carIdx of each shown row that follows skipped rows of its class (draw a separator above it). */
  afterGap: number[];
}

export type LeaderboardViewOptions = DriversAround & {
  livePositions: boolean;
  gapDecimals: Decimals;
  lapDecimals: Decimals;
};

function nullLast(a: number | null, b: number | null, descending = false): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return descending ? b - a : a - b;
}

/** Overall order: position, then (for cars without one) progress descending, then carIdx. */
function overallOrder(a: DriverRow, b: DriverRow): number {
  return (
    nullLast(a.overallPosition, b.overallPosition) ||
    nullLast(a.progressLaps, b.progressLaps, true) ||
    a.carIdx - b.carIdx
  );
}

/**
 * Which rows of one class (ordered by class position) to show.
 * `focusIndex` is the focus car's index in `classRows`, -1 when there is none.
 */
export function pickRows(
  classRows: readonly DriverRow[],
  isFocusClass: boolean,
  focusIndex: number,
  a: DriversAround,
): DriverRow[] {
  if (a.showAll) return [...classRows];
  if (!isFocusClass) return classRows.slice(0, a.topOtherClasses);
  return classRows.filter(
    (_, i) =>
      i < a.topMyClass ||
      i === focusIndex ||
      (focusIndex >= 0 && Math.abs(i - focusIndex) <= a.around),
  );
}

const EMPTY: LeaderboardView = { sections: [], multiClass: false, afterGap: [] };

export function leaderboardView(
  frame: TelemetryFrame | null,
  options: LeaderboardViewOptions,
): LeaderboardView {
  const rows = driverRows(frame, options);
  if (rows.length === 0) return EMPTY;
  rows.sort(overallOrder);
  const rank = new Map<number, number>();
  rows.forEach((r, i) => rank.set(r.carIdx, i));

  // A Map keeps insertion order: classes come out ordered by their leader's overall place.
  const classes = new Map<string, DriverRow[]>();
  for (const row of rows) {
    const list = classes.get(row.classKey);
    if (list === undefined) classes.set(row.classKey, [row]);
    else list.push(row);
  }
  const multiClass = classes.size > 1;
  const anyFocus = rows.some((r) => r.isFocus);

  const sections: LeaderboardSection[] = [];
  const afterGap: number[] = [];
  for (const [key, members] of classes) {
    const ordered = members.sort(
      (a, b) =>
        nullLast(a.position, b.position) || (rank.get(a.carIdx) ?? 0) - (rank.get(b.carIdx) ?? 0),
    );
    const focusIndex = ordered.findIndex((r) => r.isFocus);
    // Without a focus car (spectating) every class gets its top "my class" rows.
    const shown = pickRows(ordered, focusIndex >= 0 || !anyFocus, focusIndex, options);
    if (shown.length === 0) continue;
    let previous = -1;
    for (const row of shown) {
      const index = ordered.indexOf(row);
      if (previous >= 0 && index - previous > 1) afterGap.push(row.carIdx);
      previous = index;
    }
    sections.push({
      key: multiClass ? `class:${key}` : "all",
      label: multiClass ? (ordered[0]?.className ?? "Class") : "",
      colour: multiClass
        ? (ordered.find((r) => r.classColour !== null)?.classColour ?? null)
        : null,
      total: ordered.length,
      rows: shown,
    });
  }
  return { sections, multiClass, afterGap };
}

/** Keeps the previous row object for every car whose row did not change. */
export function reuseView(prev: LeaderboardView | null, next: LeaderboardView): LeaderboardView {
  if (prev === null) return next;
  const before = prev.sections.flatMap((s) => s.rows);
  return {
    ...next,
    sections: next.sections.map((s) => ({ ...s, rows: reuseRows(before, s.rows) })),
  };
}
