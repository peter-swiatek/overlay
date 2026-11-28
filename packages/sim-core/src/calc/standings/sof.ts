const B = 1600 / Math.LN2;

/**
 * iRacing's published strength-of-field formula: b = 1600 / ln 2,
 * sof = b * ln(N / sum(exp(-iR / b))). The reference does not document a formula, so we use iRacing's.
 * Only ratings above 0 count (0 and null mean "no rating"). Returns null when none count.
 */
export function strengthOfField(ratings: readonly (number | null)[]): number | null {
  let n = 0;
  let sum = 0;
  for (const r of ratings) {
    if (r === null || !Number.isFinite(r) || r <= 0) continue;
    n += 1;
    sum += Math.exp(-r / B);
  }
  if (n === 0) return null;
  return Math.round(B * Math.log(n / sum));
}
