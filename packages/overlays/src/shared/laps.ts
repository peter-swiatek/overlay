import type { TelemetryFrame } from "@overlay/sim-core/types";

/**
 * Lap marker of a car against the player, from sim-core's lap delta (races only):
 * "ahead" = it has lapped or is lapping the player, "behind" = the player has lapped or is lapping
 * it, null = same lap or unknown.
 */
export type LapStatus = "ahead" | "behind" | null;

/** The lap marker for a derived lap delta: whole laps ahead of (+) or behind (-) the player. */
export function lapStatus(lapDelta: number | null | undefined): LapStatus {
  if (lapDelta === null || lapDelta === undefined || !Number.isFinite(lapDelta)) return null;
  if (lapDelta >= 1) return "ahead";
  if (lapDelta <= -1) return "behind";
  return null;
}

/** Lap marker per carIdx for every car in derived.gaps (the player is never in it). */
export function lapStatuses(frame: TelemetryFrame): Map<number, LapStatus> {
  const out = new Map<number, LapStatus>();
  for (const g of frame.derived.gaps) out.set(g.carIdx, lapStatus(g.lapDelta));
  return out;
}
