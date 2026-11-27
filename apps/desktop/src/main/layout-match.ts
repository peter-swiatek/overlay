import {
  isEmptySimContext,
  sameSimContext,
  type LayoutMatch,
  type SimContext,
} from "../shared/layout-types";

/** What each condition adds to a group's score when it is set and matches: the car counts most. */
export const MATCH_WEIGHTS = { car: 8, carType: 4, session: 2, game: 1 } as const;

/** Car names compare without case and surrounding spaces. */
export function sameCarName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * How well a group's conditions fit the context: the sum of the weights of the conditions that
 * are set, or null when any set condition does not match (an unknown car, car type, game or
 * session matches no set condition). A group with no conditions scores 0.
 */
export function matchScore(match: LayoutMatch, context: SimContext): number | null {
  let score = 0;
  if (match.cars.length > 0) {
    const car = context.carName;
    if (car === null || !match.cars.some((c) => sameCarName(c, car))) return null;
    score += MATCH_WEIGHTS.car;
  }
  if (match.carTypes.length > 0) {
    if (context.carType === null || !match.carTypes.includes(context.carType)) return null;
    score += MATCH_WEIGHTS.carType;
  }
  if (match.sessions.length > 0) {
    if (context.sessionType === null || !match.sessions.includes(context.sessionType)) return null;
    score += MATCH_WEIGHTS.session;
  }
  if (match.game !== null) {
    if (context.sim !== match.game) return null;
    score += MATCH_WEIGHTS.game;
  }
  return score;
}

export interface MatchableLayout {
  id: string;
  match: LayoutMatch;
}

/**
 * The most specific group that matches the context: highest score wins, ties go to the first in
 * list order. The fallback group never competes; it is the answer when nothing else matches.
 */
export function pickLayout(
  layouts: readonly MatchableLayout[],
  context: SimContext,
  defaultId: string,
): string {
  let best: { id: string; score: number } | null = null;
  for (const layout of layouts) {
    if (layout.id === defaultId) continue;
    const score = matchScore(layout.match, context);
    if (score === null) continue;
    if (best === null || score > best.score) best = { id: layout.id, score };
  }
  return best?.id ?? defaultId;
}

/**
 * Decides when the automatic switch looks again: only when the (game, car, car type, session
 * type) context differs from the one it last acted on, so a group picked by hand stays until the
 * context next changes. An empty context (no sim connected) is ignored, so leaving the sim and
 * coming back to the same car and session keeps the group too.
 */
export class ContextChangeTracker {
  private last: SimContext | null = null;

  /** True when `context` is a new, non-empty context; it then becomes the one acted on. */
  observe(context: SimContext): boolean {
    if (isEmptySimContext(context)) return false;
    if (this.last !== null && sameSimContext(this.last, context)) return false;
    this.last = { ...context };
    return true;
  }

  /** Forgets the last context, so the next non-empty one is acted on (auto switch turned on). */
  reset(): void {
    this.last = null;
  }
}
