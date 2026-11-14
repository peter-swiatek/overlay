import { HEX_COLOUR } from "./colour";
import { LOCKED_COLOURS } from "./locked";
import {
  LOCKED_COLOUR_KEYS,
  THEME_TOKEN_KEYS,
  type Theme,
  type ThemeFont,
  type ThemeTokenKey,
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
};

/** Token variables in THEME_TOKEN_KEYS order, then typography. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of THEME_TOKEN_KEYS) vars[TOKEN_VARS[key]] = theme.tokens[key];
  vars["--ov-font-family"] = FONT_FAMILIES[theme.font];
  vars["--ov-font-weight"] = String(theme.weight);
  vars["--ov-font-size"] = theme.compact ? "12px" : "14px";
  vars["--ov-row-height"] = theme.compact ? "20px" : "24px";
  vars["--ov-cell-pad-x"] = theme.compact ? "5px" : "7px";
  return vars;
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
