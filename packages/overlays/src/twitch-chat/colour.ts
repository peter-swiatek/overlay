/**
 * Name colours. Twitch users pick their own; the overlay shows them, lightened when too dark to
 * read on the dark panel. Users without one get a colour from a small fixed palette of the app's
 * locked colours, the same for the same name every time.
 */
import { LOCKED_COLOURS, contrastOfRgb } from "@overlay/theme";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The panel's background as the names are read against it (dark theme tint over a dark scene). */
export const NAME_BACKDROP = "#14161b";
/** Smallest contrast a name keeps against the backdrop (WCAG AA for text). */
export const MIN_NAME_CONTRAST = 4.5;

/** Names without a colour of their own: locked colours that read well on the dark panel. */
export const FALLBACK_NAME_COLOURS: readonly string[] = [
  LOCKED_COLOURS.shift,
  LOCKED_COLOURS.flagYellow,
  LOCKED_COLOURS.gain,
  LOCKED_COLOURS.pitExit,
  LOCKED_COLOURS.lapAhead,
  LOCKED_COLOURS.flagMeatball,
  LOCKED_COLOURS.fastest,
];

/** "#rrggbb" in lower case, or null for anything else (names, short forms, alpha, markup). */
export function sanitiseHexColour(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
}

function rgbOf(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function hexOf(c: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Mixes `c` towards white by `t` (0..1). */
function towardWhite(c: Rgb, t: number): Rgb {
  return { r: c.r + (255 - c.r) * t, g: c.g + (255 - c.g) * t, b: c.b + (255 - c.b) * t };
}

/**
 * `hex` itself when it reads on the backdrop, otherwise the least lightened version of it (mixed
 * towards white in 5 % steps) that does. Keeps the hue, so a dark blue stays blue.
 */
export function readableNameColour(
  hex: string,
  backdrop: string = NAME_BACKDROP,
  minContrast: number = MIN_NAME_CONTRAST,
): string {
  const base = rgbOf(hex);
  const bg = rgbOf(backdrop);
  for (let step = 0; step <= 20; step++) {
    const c = towardWhite(base, step / 20);
    if (contrastOfRgb(c, bg) >= minContrast) return hexOf(c);
  }
  return "#ffffff";
}

/** FNV-1a, 32 bit: a small stable hash for picking a palette colour. */
export function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The palette colour for a name without one of its own (by lowercase login). */
export function fallbackNameColour(login: string): string {
  const palette = FALLBACK_NAME_COLOURS;
  return palette[nameHash(login.toLowerCase()) % palette.length] ?? LOCKED_COLOURS.shift;
}

/** The colour a name is drawn in: the user's own when valid, else the fallback; always readable. */
export function nameColour(color: string | null | undefined, login: string): string {
  return readableNameColour(sanitiseHexColour(color) ?? fallbackNameColour(login));
}
