/**
 * Projected iRating change for a race in progress. This is an estimate for display, not the
 * sim's own result.
 *
 * Elo-style model, per class, using the live class order:
 *
 *   B = 1600 / ln 2,  q(r) = exp(-r / B)
 *   P(a beats b) = ((1 - q(a)) q(b)) / ((1 - q(b)) q(a) + (1 - q(a)) q(b))
 *   for driver i of n at position p_i:
 *     expected_i = sum over j != i of P(r_i beats r_j)
 *     fudge_i    = (n / 2 - p_i) / 100
 *     change_i   = (n - p_i - expected_i - fudge_i) * 200 / n
 *
 * Only cars with an iRating above 0 and a finite position count; fewer than two such cars give
 * no projection.
 */

const B = 1600 / Math.LN2;

function q(rating: number): number {
  return Math.exp(-rating / B);
}

/** Probability that a driver rated `a` finishes ahead of one rated `b`. */
function beats(a: number, b: number): number {
  const qa = q(a);
  const qb = q(b);
  const win = (1 - qa) * qb;
  return win / ((1 - qb) * qa + win);
}

/** Ratings and live class positions of one class; returns carIdx -> rounded change. */
export function projectIRatingChanges(
  field: readonly { carIdx: number; iRating: number; position: number }[],
): Map<number, number> {
  const out = new Map<number, number>();
  const cars = field
    .filter((c) => Number.isFinite(c.iRating) && c.iRating > 0 && Number.isFinite(c.position))
    .sort((a, b) => a.position - b.position || a.carIdx - b.carIdx);
  const n = cars.length;
  if (n < 2) return out;
  for (let i = 0; i < n; i++) {
    const me = cars[i] as (typeof cars)[number];
    const p = i + 1;
    let expected = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i) expected += beats(me.iRating, (cars[j] as (typeof cars)[number]).iRating);
    }
    const fudge = (n / 2 - p) / 100;
    const change = ((n - p - expected - fudge) * 200) / n;
    out.set(me.carIdx, Math.round(change) + 0);
  }
  return out;
}
