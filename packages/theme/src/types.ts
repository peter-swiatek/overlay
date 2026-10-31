export const THEME_TOKEN_KEYS = [
  "backgroundTint",
  "row",
  "rowAlt",
  "header",
  "accent",
  "text",
  "textMuted",
  "border",
  "ownRow",
] as const;
export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];
/** Each value "#rrggbb" or "#rrggbbaa", lower case. */
export type ThemeTokens = Record<ThemeTokenKey, string>;

export const THEME_FONTS = ["inter", "manrope", "oswald", "barlow-condensed"] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];
export const THEME_WEIGHTS = [400, 500, 600, 700, 800] as const;
export type ThemeWeight = (typeof THEME_WEIGHTS)[number];

export interface Theme {
  /** Preset ids are fixed words ("graphite"); custom ids start with "custom-". */
  id: string;
  /** 1..40 printable characters. */
  name: string;
  tokens: ThemeTokens;
  font: ThemeFont;
  weight: ThemeWeight;
  compact: boolean;
}

export interface ThemeState {
  activeId: string;
  presets: readonly Theme[];
  custom: readonly Theme[];
}

export type ThemeImportResult =
  { ok: true; theme: Theme; state: ThemeState } | { ok: false; error: string };

/** Meaning colours. Never part of a theme; no theme, import or code can change them. */
export const LOCKED_COLOUR_KEYS = [
  "gain",
  "loss",
  "fastest",
  "licenceR",
  "licenceD",
  "licenceC",
  "licenceB",
  "licenceA",
  "licencePro",
  "rejoinYellow",
  "rejoinRed",
  "lapFaster",
  "lapSlower",
  "flagGreen",
  "flagYellow",
  "flagBlue",
  "flagWhite",
  "flagRed",
  "flagBlack",
] as const;
export type LockedColourKey = (typeof LOCKED_COLOUR_KEYS)[number];
