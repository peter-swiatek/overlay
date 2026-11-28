import { wrapPctDiff } from "./relativeGap";

/** Race distance of one car: whole laps completed and the fraction of the current lap. */
export interface LapProgress {
  lapsCompleted: number | null;
  /** 0..1; null, negative or non-finite means the car is not in the world. */
  lapDistPct: number | null;
}

function usable(p: LapProgress): p is { lapsCompleted: number; lapDistPct: number } {
  return (
    p.lapsCompleted !== null &&
    Number.isFinite(p.lapsCompleted) &&
    p.lapsCompleted >= 0 &&
    p.lapDistPct !== null &&
    Number.isFinite(p.lapDistPct) &&
    p.lapDistPct >= 0 &&
    p.lapDistPct <= 1
  );
}

/**
 * Whole laps between a car and the player once their on-track proximity is taken out:
 * `round((carTotal - playerTotal) - wrapPctDiff(carPct - playerPct))`, where total = laps
 * completed + lap fraction. Positive = the car has lapped the player (it is that many laps ahead);
 * negative = the player has lapped it; 0 = same lap. So a car just across the line ahead of a
 * player about to cross it is on the same lap, and a car physically just ahead but a full lap up
 * in distance gives +1. A car exactly half a lap away counts as ahead on track (the wrap keeps
 * +0.5). Null when either car's laps or position are unknown.
 */
export function lapDelta(player: LapProgress, car: LapProgress): number | null {
  if (!usable(player) || !usable(car)) return null;
  const diffPct = car.lapDistPct - player.lapDistPct;
  const total = car.lapsCompleted - player.lapsCompleted + diffPct;
  const delta = Math.round(total - wrapPctDiff(diffPct));
  // Avoid -0.
  return delta === 0 ? 0 : delta;
}
