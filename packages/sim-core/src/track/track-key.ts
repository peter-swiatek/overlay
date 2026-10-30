import type { SimState } from "../model";

/**
 * Identifies one track layout: sim, track name and layout name, as lower-case words joined by
 * hyphens, the three parts joined by underscores. It is safe as a file name on every OS.
 * Null while the sim or the track name is not known yet.
 */
export function trackKeyOf(state: SimState): string | null {
  const name = slug(state.session.trackName);
  if (state.sim === null || name === "") return null;
  const config = slug(state.session.trackConfig);
  return config === "" ? `${state.sim}_${name}` : `${state.sim}_${name}_${config}`;
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
