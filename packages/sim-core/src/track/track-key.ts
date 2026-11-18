import type { SimState } from "../model";

/**
 * Identifies one track layout: sim, track name and layout name, as lower-case words joined by
 * hyphens, the three parts joined by underscores. It is safe as a file name on every OS.
 * When the sim names no layout (LMU) the track length in metres, rounded to 10 m, stands in for it,
 * so that two layouts of one track do not share a file. Null while the sim or the track name is
 * not known yet. The mock source names no sim and uses "mock" in its place.
 */
export function trackKeyOf(state: SimState): string | null {
  const name = slug(state.session.trackName);
  const sim = state.sim ?? (state.source === "mock" ? "mock" : null);
  if (sim === null || name === "") return null;
  const config = slug(state.session.trackConfig);
  if (config !== "") return `${sim}_${name}_${config}`;
  const length = state.session.trackLengthM;
  const suffix = length !== null && length > 0 ? `_${Math.round(length / 10) * 10}m` : "";
  return `${sim}_${name}${suffix}`;
}

/** Keys that differ only in the rounded length (by up to this many metres) are one track. */
const LENGTH_SLACK_M = 20;

/** True when two keys name the same layout, allowing for the rounded length to differ a little. */
export function sameTrackKey(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = /^(.*)_(\d+)m$/.exec(a);
  const pb = /^(.*)_(\d+)m$/.exec(b);
  if (pa === null || pb === null || pa[1] !== pb[1]) return false;
  return Math.abs(Number(pa[2]) - Number(pb[2])) <= LENGTH_SLACK_M;
}

function slug(text: string | null): string {
  if (text === null) return "";
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
