import { HEX_COLOUR } from "./colour";
import { LOCKED_COLOURS } from "./locked";
import {
  LOCKED_COLOUR_KEYS,
  THEME_TOKEN_KEYS,
  type Theme,
  type ThemeFont,
  type ThemeTokenKey,
  type Typography,
} from "./types";

const TOKEN_VARS: Record<ThemeTokenKey, string> = {
  backgroundTint: "--ov-bg",
  row: "--ov-row",
  rowAlt: "--ov-row-alt",
  header: "--ov-header",
  accent: "--ov-accent",
  text: "--ov-text",
  textMuted: "--ov-text-muted",
  border: "--ov-border",
  ownRow: "--ov-own-row",
};

const FONT_FAMILIES: Record<ThemeFont, string> = {
  inter: '"Inter", system-ui, sans-serif',
  manrope: '"Manrope", system-ui, sans-serif',
  oswald: '"Oswald", system-ui, sans-serif',
  "barlow-condensed": '"Barlow Condensed", system-ui, sans-serif',
  "dm-sans": '"DM Sans", system-ui, sans-serif',
  figtree: '"Figtree", system-ui, sans-serif',
  urbanist: '"Urbanist", system-ui, sans-serif',
};

/** The CSS font-family stack the overlays use for `font`. */
export function fontFamilyCss(font: ThemeFont): string {
  return FONT_FAMILIES[font];
}

/** Font and density variables. They come from the global typography, never from a theme. */
export function typographyToCssVars(typography: Typography): Record<string, string> {
  const { compact } = typography;
  return {
    "--ov-font-family": FONT_FAMILIES[typography.font],
    "--ov-font-weight": String(typography.weight),
    // Regular rows are roomy (2 em); compact keeps the text size and tightens the rows
    // and the space between columns.
    "--ov-font-size": "14px",
    "--ov-row-height": compact ? "20px" : "28px",
    "--ov-cell-pad-x": compact ? "3px" : "5px",
  };
}

/** The theme's token variables in THEME_TOKEN_KEYS order, then the typography variables. */
export function themeToCssVars(theme: Theme, typography: Typography): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) vars[TOKEN_VARS[key]] = theme.tokens[key];
  return { ...vars, ...typographyToCssVars(typography) };
}

/** `licencePro` becomes `--ov-locked-licence-pro`. */
export function lockedCssVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of LOCKED_COLOUR_KEYS) {
    const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    vars[`--ov-locked-${kebab}`] = LOCKED_COLOURS[key];
  }
  return vars;
}

/** "accent" follows the theme; a valid hex stays; anything else falls back to the accent. */
export function resolveFunctionalColour(value: string, theme: Theme): string {
  if (value === "accent") return theme.tokens.accent;
  return HEX_COLOUR.test(value) ? value : theme.tokens.accent;
}
