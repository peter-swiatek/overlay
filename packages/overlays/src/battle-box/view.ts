import type { StandingsEntry, StandingsGap, TelemetryFrame } from "@overlay/sim-core/types";
import type { Decimals } from "@overlay/ui/types";
import { threatLevel, type ThreatLevel } from "../relative/view";
import { driverRows, reuseRows, type DriverRow } from "../shared";

export type BattleRole = "ahead" | "own" | "behind";

/** A driver row with what only the Battle Box shows. */
export interface BattleRow extends DriverRow {
  role: BattleRole;
  /** Int column: "-2.5" ahead, "0.0" own, "+0.8" behind, "1L" lapped, "--" unknown. */
  intText: string;
  /** Threat colour of the car behind (null for the others, or with the option off). */
  threat: ThreatLevel;
  /** The last lap is the session or class best: drawn in the fastest-lap colour. */
  lastFastest: boolean;
}

export interface BattleOptions {
  livePositions: boolean;
  gapDecimals: Decimals;
  lapDecimals: Decimals;
  gapThreat: boolean;
}

export interface BattleView {
  /** The car ahead in class (when there is one), the focus car, the car behind (when there is one). */
  rows: BattleRow[];
  /**
   * Sector deltas (your latest time minus theirs, rounded to 0.01 s; negative = you were faster)
   * against the car ahead and the car behind, one per official sector; an entry is null until both
   * cars have a time for that sector. Null without that car or without sector data.
   */
  aheadSectors: (number | null)[] | null;
  behindSectors: (number | null)[] | null;
}

const EMPTY: BattleView = { rows: [], aheadSectors: null, behindSectors: null };

/** Seconds with a sign, "<n>L" (signed) in whole laps, "--" unknown. */
export function intText(gap: StandingsGap | null, sign: "-" | "+", decimals: Decimals): string {
  if (gap === null) return "--";
  if (gap.laps >= 1) return `${sign}${gap.laps}L`;
  const s = gap.seconds;
  if (s === null || !Number.isFinite(s) || s < 0) return "--";
  return `${sign}${s.toFixed(decimals)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

/** Your latest sector times minus theirs; null when neither car has sector data. */
export function sectorDeltas(
  mine: readonly (number | null)[] | null | undefined,
  theirs: readonly (number | null)[] | null | undefined,
): (number | null)[] | null {
  const n = mine?.length ?? theirs?.length;
  if (n === undefined) return null;
  return Array.from({ length: n }, (_, i) => {
    const a = mine?.[i] ?? null;
    const b = theirs?.[i] ?? null;
    return a === null || b === null ? null : round2(a - b);
  });
}

/**
 * The cars one place ahead and behind the focus car in its own class (class position in the
 * chosen live / official mode, as the other overlays). The gaps are the ones at the timing line
 * in a race (`lineInterval`: yours to the car ahead when you last crossed it, the car behind's to
 * you when it last did), so they change once a lap; outside races the best-lap gaps. Sector
 * deltas change only when a car completes a sector. `previous` keeps unchanged rows' identity.
 */
export function battleView(
  frame: TelemetryFrame | null,
  options: BattleOptions,
  previous: readonly BattleRow[] = [],
): BattleView {
  if (frame === null || frame.status !== "live") return EMPTY;
  const all = driverRows(frame, options);
  const focus = all.find((r) => r.isFocus);
  if (focus === undefined) return EMPTY;
  const entries = new Map<number, StandingsEntry>();
  for (const e of frame.derived.standings?.entries ?? []) entries.set(e.carIdx, e);
  const race = frame.state.session.type === "race";
  const gapOf = (e: StandingsEntry | undefined): StandingsGap | null =>
    (race ? e?.lineInterval : e?.interval) ?? null;

  const near = (offset: number): DriverRow | undefined =>
    focus.position === null
      ? undefined
      : all.find(
          (r) =>
            !r.isFocus && r.classKey === focus.classKey && r.position === focus.position! + offset,
        );
  const ahead = near(-1);
  const behind = near(1);
  const mine = entries.get(focus.carIdx);

  const withRole = (row: DriverRow, role: BattleRole): BattleRow => {
    let text = (0).toFixed(options.gapDecimals);
    let threat: ThreatLevel = null;
    if (role === "ahead") text = intText(gapOf(mine), "-", options.gapDecimals);
    if (role === "behind") {
      const gap = gapOf(entries.get(row.carIdx));
      text = intText(gap, "+", options.gapDecimals);
      if (options.gapThreat && gap !== null && gap.laps === 0 && gap.seconds !== null) {
        threat = threatLevel(Number(gap.seconds.toFixed(options.gapDecimals)));
      }
    }
    return {
      ...row,
      role,
      intText: text,
      threat,
      lastFastest: row.fastest && row.lastLapS !== null && row.lastLapS === row.bestLapS,
    };
  };

  const next: BattleRow[] = [];
  if (ahead !== undefined) next.push(withRole(ahead, "ahead"));
  next.push(withRole(focus, "own"));
  if (behind !== undefined) next.push(withRole(behind, "behind"));
  const sectorsWith = (row: DriverRow | undefined): (number | null)[] | null =>
    row === undefined
      ? null
      : sectorDeltas(mine?.sectorTimes, entries.get(row.carIdx)?.sectorTimes ?? null);
  return {
    rows: reuseRows(previous, next),
    aheadSectors: sectorsWith(ahead),
    behindSectors: sectorsWith(behind),
  };
}
