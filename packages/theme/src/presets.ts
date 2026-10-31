import type { Theme } from "./types";

export const DEFAULT_THEME_ID = "graphite";

export const GRAPHITE: Theme = {
  id: "graphite",
  name: "Graphite",
  tokens: {
    backgroundTint: "#0a0c10b8",
    row: "#00000000",
    rowAlt: "#ffffff0a",
    header: "#ffffff14",
    accent: "#ffc400",
    text: "#f2f4f8",
    textMuted: "#c4c9d2",
    border: "#ffffff1f",
    ownRow: "#ffc40047",
  },
  font: "inter",
  weight: 500,
  compact: false,
};

/** The theme ticket adds the other presets. */
export const THEME_PRESETS: readonly Theme[] = [GRAPHITE];
