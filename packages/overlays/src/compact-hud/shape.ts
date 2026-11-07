/**
 * The outline of the capsule with its optional gap tabs, in the 340 x 172 box. The tabs grow out
 * of the capsule on smooth curves, so the readouts are part of the panel. Numbers come from the
 * design hand-off.
 */
export function hudShape(top: boolean, bottom: boolean): string {
  let d = "M55,48 ";
  if (top) d += "L96,48 C112,48 110,28 126,28 L214,28 C230,28 228,48 244,48 ";
  d += "L285,48 A50,50 0 0 1 285,148 ";
  if (bottom) d += "L244,148 C228,148 230,168 214,168 L126,168 C110,168 112,148 96,148 ";
  d += "L55,148 A50,50 0 0 1 55,48 Z";
  return d;
}
