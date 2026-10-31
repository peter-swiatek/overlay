import { HEX_COLOUR } from "./colour";
import { GRAPHITE } from "./presets";
import {
  THEME_FONTS,
  THEME_TOKEN_KEYS,
  THEME_WEIGHTS,
  type Theme,
  type ThemeFont,
  type ThemeTokenKey,
  type ThemeTokens,
  type ThemeWeight,
} from "./types";

export type ThemeResult = { ok: true; theme: Theme } | { ok: false; error: string };

export const FALLBACK_THEME_NAME = "Imported theme";
export const MAX_THEME_NAME = 40;

const TOKEN_LABELS: Record<ThemeTokenKey, string> = {
  backgroundTint: "background tint",
  row: "row",
  rowAlt: "alternate row",
  header: "header",
  accent: "accent",
  text: "text",
  textMuted: "muted text",
  border: "border",
  ownRow: "own row",
};

const CUSTOM_ID_LENGTH = 8;

/** "custom-" + 8 base36 characters. `random` is injectable for tests. */
export function newCustomId(random: () => number = Math.random): string {
  let id = "custom-";
  for (let i = 0; i < CUSTOM_ID_LENGTH; i++) id += Math.floor(random() * 36).toString(36);
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeThemeName(value: unknown): string {
  if (typeof value !== "string") return FALLBACK_THEME_NAME;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  const name = Array.from(clean).slice(0, MAX_THEME_NAME).join("").trim();
  return name === "" ? FALLBACK_THEME_NAME : name;
}

function isFont(value: unknown): value is ThemeFont {
  return THEME_FONTS.some((f) => f === value);
}

function isWeight(value: unknown): value is ThemeWeight {
  return THEME_WEIGHTS.some((w) => w === value);
}

/**
 * Builds a Theme from untrusted data. Only known fields are read, so extra keys (including every
 * locked colour name, at any depth) never reach the result.
 */
export function sanitizeTheme(raw: unknown): ThemeResult {
  if (!isRecord(raw)) return { ok: false, error: "This is not a theme" };
  const rawTokens = raw.tokens;
  if (!isRecord(rawTokens)) return { ok: false, error: "This theme has no colours" };
  const tokens: Partial<ThemeTokens> = {};
  for (const key of THEME_TOKEN_KEYS) {
    const value = rawTokens[key];
    if (value === undefined) {
      return { ok: false, error: `This theme is missing the ${TOKEN_LABELS[key]} colour` };
    }
    if (typeof value !== "string" || !HEX_COLOUR.test(value)) {
      return { ok: false, error: `The ${TOKEN_LABELS[key]} colour is not a valid colour` };
    }
    tokens[key] = value.toLowerCase();
  }
  const id =
    typeof raw.id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.id) ? raw.id : newCustomId();
  return {
    ok: true,
    theme: {
      id,
      name: sanitizeThemeName(raw.name),
      tokens: tokens as ThemeTokens,
      font: isFont(raw.font) ? raw.font : GRAPHITE.font,
      weight: isWeight(raw.weight) ? raw.weight : GRAPHITE.weight,
      compact: typeof raw.compact === "boolean" ? raw.compact : false,
    },
  };
}

/** A copy of `base` with a new custom id and a unique "<name> (custom)" name. */
export function forkTheme(
  base: Theme,
  existing: readonly Theme[],
  random: () => number = Math.random,
): Theme {
  const ids = new Set(existing.map((t) => t.id));
  let id = newCustomId(random);
  while (ids.has(id)) id = newCustomId(random);
  const names = new Set(existing.map((t) => t.name));
  const fit = (stem: string, suffix: string): string =>
    Array.from(stem)
      .slice(0, MAX_THEME_NAME - suffix.length)
      .join("")
      .trimEnd() + suffix;
  let name = fit(base.name, " (custom)");
  for (let n = 2; names.has(name); n++) name = fit(`${base.name} (custom)`, ` ${n}`);
  return { ...base, id, name, tokens: { ...base.tokens } };
}
