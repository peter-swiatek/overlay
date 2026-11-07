import type { TelemetryFrame } from "@overlay/sim-core/types";
import type { Decimals } from "@overlay/ui/types";
import { driverRows, flagBorderColour, reuseRows, type DriverRow } from "../shared";

export type ThreatLevel = "red" | "yellow" | null;

export interface RelativeOptions {
  ahead: number;
  behind: number;
  hideInPits: boolean;
  gapThreat: boolean;
  livePositions: boolean;
  gapDecimals: Decimals;
  lapDecimals: Decimals;
  /** Passed through to the view for infoItems. */
  headerIds?: readonly string[];
  footerIds?: readonly string[];
}

/** A driver row carrying its gap-threat colour, so a row only re-renders when its own content changes. */
export interface RelativeRow extends DriverRow {
  threat: ThreatLevel;
}

export interface RelativeView {
  /** Farthest ahead first, then the focus car, then the nearest behind … farthest behind last. */
  rows: RelativeRow[];
  /** gapThreat per carIdx (empty when the option is off). */
  threats: Record<number, ThreatLevel>;
  headerIds: string[];
  footerIds: string[];
  flagColour: string | null;
}

// Default chosen by the orchestrator, not confirmed by Peter (the reference threat rule is undocumented):
// a car behind within 1.0 s shows red, within 2.0 s yellow. Cars ahead are never coloured.
const RED_WITHIN_S = 1.0;
const YELLOW_WITHIN_S = 2.0;

/** Only for a car behind (raw gap >= 0; the view puts exactly 0 behind), , judged on the rounded gap shown in the row. */
export function gapThreat(row: DriverRow, rawGapS: number | null): ThreatLevel {
  if (rawGapS === null || rawGapS < 0 || row.relativeGapS === null) return null;
  if (row.relativeGapS <= RED_WITHIN_S) return "red";
  if (row.relativeGapS <= YELLOW_WITHIN_S) return "yellow";
  return null;
}

interface Candidate {
  row: DriverRow;
  raw: number;
}

/**
 * The cars around the focus car. Side and order use the raw gap; colour uses the rounded one, so
 * a car at -0.04 s (prints "0.0") stays ahead and a car at +0.04 s stays behind and is red.
 * `previous` is the last view's rows, so unchanged rows keep their identity.
 */
export function relativeView(
  frame: TelemetryFrame | null,
  options: RelativeOptions,
  previous: readonly RelativeRow[] = [],
): RelativeView {
  const headerIds = [...(options.headerIds ?? [])];
  const footerIds = [...(options.footerIds ?? [])];
  const empty: RelativeView = { rows: [], threats: {}, headerIds, footerIds, flagColour: null };
  if (frame === null || frame.status !== "live") return empty;
  const flagColour = flagBorderColour(frame.state.flags);
  const all = driverRows(frame, options);
  const focus = all.find((r) => r.isFocus);
  if (focus === undefined) return { ...empty, flagColour };

  const raw = new Map<number, number | null>();
  for (const g of frame.derived.gaps) raw.set(g.carIdx, g.gapS);
  const connected = new Set<number>();
  for (const car of frame.state.cars) if (car.connected) connected.add(car.carIdx);

  const ahead: Candidate[] = [];
  const behind: Candidate[] = [];
  for (const row of all) {
    if (row.isFocus || row.relativeGapS === null || !connected.has(row.carIdx)) continue;
    if (options.hideInPits && row.onPitRoad) continue;
    const gap = raw.get(row.carIdx) ?? null;
    if (gap === null || !Number.isFinite(gap)) continue;
    (gap < 0 ? ahead : behind).push({ row, raw: gap });
  }
  ahead.sort((a, b) => b.raw - a.raw);
  behind.sort((a, b) => a.raw - b.raw);
  const nearAhead = ahead.slice(0, Math.max(0, options.ahead)).reverse();
  const nearBehind = behind.slice(0, Math.max(0, options.behind));

  const threats: Record<number, ThreatLevel> = {};
  if (options.gapThreat) {
    for (const { row, raw: gap } of nearBehind) {
      const level = gapThreat(row, gap);
      if (level !== null) threats[row.carIdx] = level;
    }
  }
  const withThreat = (row: DriverRow): RelativeRow => ({
    ...row,
    threat: threats[row.carIdx] ?? null,
  });
  const rows = reuseRows(previous, [
    ...nearAhead.map((c) => withThreat(c.row)),
    withThreat(focus),
    ...nearBehind.map((c) => withThreat(c.row)),
  ]);
  return { rows, threats, headerIds, footerIds, flagColour };
}
