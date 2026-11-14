import type { TelemetryFrame } from "@overlay/sim-core/types";
import type { Decimals } from "@overlay/ui/types";
import {
  driverRows,
  flagBorderColour,
  lapStatus,
  reuseRows,
  type DriverRow,
  type LapStatus,
} from "../shared";

export interface RelativeOptions {
  ahead: number;
  behind: number;
  hideInPits: boolean;
  /**
   * Colour each car by its status: in pits, or a lap or more ahead or behind (lap status in races
   * only; sim-core gives no lap delta otherwise).
   */
  lapColours?: boolean;
  livePositions: boolean;
  gapDecimals: Decimals;
  lapDecimals: Decimals;
  /** Passed through to the view for infoItems. */
  headerIds?: readonly string[];
  footerIds?: readonly string[];
}

/** The one status colour of a car: in pits beats a lap or more ahead or behind; null is normal text. */
export type CarStatus = "pit" | Exclude<LapStatus, null> | null;

/** A driver row carrying its status colour, so a row only re-renders when its own content changes. */
export interface RelativeRow extends DriverRow {
  status: CarStatus;
}

export interface RelativeView {
  /** Farthest ahead first, then the focus car, then the nearest behind … farthest behind last. */
  rows: RelativeRow[];
  headerIds: string[];
  footerIds: string[];
  flagColour: string | null;
}

/** A car's status colour; pits take precedence over lap status. */
export function carStatus(row: DriverRow, lap: LapStatus): CarStatus {
  if (row.onPitRoad || row.inPitStall) return "pit";
  return lap;
}

interface Candidate {
  row: DriverRow;
  raw: number;
}

/**
 * The cars around the focus car. Side and order use the raw gap, so a car at -0.04 s (prints
 * "0.0") stays ahead and a car at +0.04 s stays behind.
 * `previous` is the last view's rows, so unchanged rows keep their identity.
 */
export function relativeView(
  frame: TelemetryFrame | null,
  options: RelativeOptions,
  previous: readonly RelativeRow[] = [],
): RelativeView {
  const headerIds = [...(options.headerIds ?? [])];
  const footerIds = [...(options.footerIds ?? [])];
  const empty: RelativeView = { rows: [], headerIds, footerIds, flagColour: null };
  if (frame === null || frame.status !== "live") return empty;
  const flagColour = flagBorderColour(frame.state.flags);
  const all = driverRows(frame, options);
  const focus = all.find((r) => r.isFocus);
  if (focus === undefined) return { ...empty, flagColour };

  const raw = new Map<number, number | null>();
  const laps = new Map<number, LapStatus>();
  for (const g of frame.derived.gaps) {
    raw.set(g.carIdx, g.gapS);
    if (options.lapColours === true) laps.set(g.carIdx, lapStatus(g.lapDelta));
  }
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

  const colour = options.lapColours === true;
  const withStatus = (row: DriverRow): RelativeRow => ({
    ...row,
    status: !colour || row.isFocus ? null : carStatus(row, laps.get(row.carIdx) ?? null),
  });
  const rows = reuseRows(previous, [
    ...nearAhead.map((c) => withStatus(c.row)),
    withStatus(focus),
    ...nearBehind.map((c) => withStatus(c.row)),
  ]);
  return { rows, headerIds, footerIds, flagColour };
}
