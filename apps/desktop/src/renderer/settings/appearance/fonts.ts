import type { ThemeFont, ThemeWeight } from "@overlay/theme/types";

export const FONT_LABELS: Record<ThemeFont, string> = {
  inter: "Inter",
  manrope: "Manrope",
  oswald: "Oswald",
  "barlow-condensed": "Barlow Condensed",
  "dm-sans": "DM Sans",
  figtree: "Figtree",
  urbanist: "Urbanist",
};

/**
 * The heaviest bundled weight of each font (see renderer/theme/fonts.css). Every font starts at
 * 400; a heavier choice renders at this weight instead.
 */
export const FONT_MAX_WEIGHT: Record<ThemeFont, ThemeWeight> = {
  inter: 800,
  manrope: 800,
  oswald: 700,
  "barlow-condensed": 800,
  "dm-sans": 800,
  figtree: 800,
  urbanist: 800,
};

const WEIGHT_NAMES: Record<ThemeWeight, string> = {
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
};

export const WEIGHT_LABELS: Record<ThemeWeight, string> = {
  400: "Regular 400",
  500: "Medium 500",
  600: "SemiBold 600",
  700: "Bold 700",
  800: "ExtraBold 800",
};

/** A note under the weight picker for a font that lacks some weights, or undefined. */
export function fontWeightNote(font: ThemeFont): string | undefined {
  const max = FONT_MAX_WEIGHT[font];
  if (max >= 800) return undefined;
  return `${FONT_LABELS[font]} has no ${WEIGHT_NAMES[800]}; 800 shows as ${WEIGHT_NAMES[max]}.`;
}

/** Shown beside each font name in the font list, so the digits can be compared. */
export const FONT_SAMPLE = "1:42.318  P3  Lap 12";
