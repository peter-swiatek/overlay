import { compositeOver, luminance, overBlack } from "@overlay/theme";
import type { ThemeTokens } from "@overlay/theme/types";

/*
 * Bundled manufacturer logos (./make-logos, see THIRD_PARTY_NOTICES.md), one per make id
 * (sim-core car-make.ts). A file `<id>.svg|png` is drawn on dark rows; an optional
 * `<id>.on-light.svg|png` replaces it on light rows (e.g. the dark-ink version of a white logo).
 * Logos the user puts in <userData>/logos/ (handed over as data URLs) win over both.
 */

const FILES = import.meta.glob<string>("./make-logos/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Whether a row background is dark or light, for picking a logo variant. */
export type RowTone = "dark" | "light";

export interface MakeLogoFiles {
  /** For dark rows (and the only file when there is no light-row variant). */
  dark: string;
  /** For light rows; undefined when the dark-row file serves both. */
  light?: string;
}

/** Make id -> files, from the bundled folder. */
export function bundledLogos(
  files: Readonly<Record<string, string>>,
): Record<string, MakeLogoFiles> {
  const out: Record<string, MakeLogoFiles> = {};
  const light: Record<string, string> = {};
  for (const [path, url] of Object.entries(files)) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const match = /^([a-z0-9-]+)(\.on-light)?\.(?:svg|png)$/.exec(name);
    if (match === null) continue;
    const id = match[1] as string;
    if (match[2] === undefined) out[id] = { ...out[id], dark: url };
    else light[id] = url;
  }
  for (const [id, url] of Object.entries(light)) {
    const entry = out[id];
    if (entry !== undefined) entry.light = url;
  }
  return out;
}

export const BUNDLED_LOGOS: Readonly<Record<string, MakeLogoFiles>> = bundledLogos(FILES);

export interface ResolvedLogo {
  src: string;
}

/**
 * The logo for a make on a row of the given tone: the user's file (`overrides`, by make id)
 * first, then the bundled light-row variant on light rows, else the bundled file. Null when there
 * is none (the cell then shows the make's text code).
 */
export function resolveLogo(
  make: string,
  tone: RowTone,
  overrides: Readonly<Record<string, string>> = {},
  bundled: Readonly<Record<string, MakeLogoFiles>> = BUNDLED_LOGOS,
): ResolvedLogo | null {
  const own = overrides[make];
  if (own !== undefined) return { src: own };
  const files = bundled[make];
  if (files === undefined) return null;
  return { src: tone === "light" && files.light !== undefined ? files.light : files.dark };
}

/**
 * Luminance below which a background counts as dark: where white and black text have the same
 * contrast against it ((1 + 0.05) / (L + 0.05) = (L + 0.05) / 0.05).
 */
export const DARK_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;

export interface RowTones {
  row: RowTone;
  /** The own-car row, drawn with the own-row highlight over the row. */
  own: RowTone;
}

/**
 * Tones of a theme's rows: the row colour over the panel tint, the tint over black (the sim
 * image behind is unknown, and mostly dark); the own row adds its highlight on top.
 */
export function rowTones(tokens: Pick<ThemeTokens, "backgroundTint" | "row" | "ownRow">): RowTones {
  const panel = overBlack(tokens.backgroundTint) ?? { r: 0, g: 0, b: 0 };
  const row = compositeOver(tokens.row, panel) ?? panel;
  const own = compositeOver(tokens.ownRow, row) ?? row;
  const tone = (c: { r: number; g: number; b: number }): RowTone =>
    luminance(c) < DARK_LUMINANCE ? "dark" : "light";
  return { row: tone(row), own: tone(own) };
}

/** Dark rows: what the overlays assume until the theme is known. */
export const DARK_ROWS: RowTones = { row: "dark", own: "dark" };
