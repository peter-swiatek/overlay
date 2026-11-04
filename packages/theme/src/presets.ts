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
    ownRow: "#1496b452",
  },
  font: "inter",
  weight: 500,
  compact: false,
};

const MIDNIGHT: Theme = {
  id: "midnight",
  name: "Midnight",
  tokens: {
    backgroundTint: "#060b1abd",
    row: "#00000000",
    rowAlt: "#8aa4ff0d",
    header: "#8aa4ff1a",
    accent: "#5b8cff",
    text: "#e8eeff",
    textMuted: "#aab6d8",
    border: "#8aa4ff26",
    ownRow: "#1496b452",
  },
  font: "manrope",
  weight: 500,
  compact: false,
};

const CARBON: Theme = {
  id: "carbon",
  name: "Carbon",
  tokens: {
    backgroundTint: "#000000c7",
    row: "#00000000",
    rowAlt: "#ffffff08",
    header: "#ffffff12",
    accent: "#ff7a1a",
    text: "#ffffff",
    textMuted: "#bdbdbd",
    border: "#ffffff1a",
    ownRow: "#1496b452",
  },
  font: "barlow-condensed",
  weight: 600,
  compact: true,
};

const PADDOCK: Theme = {
  id: "paddock",
  name: "Paddock",
  tokens: {
    backgroundTint: "#0b1410bd",
    row: "#00000000",
    rowAlt: "#ffffff0a",
    header: "#2dd4bf1a",
    accent: "#2dd4bf",
    text: "#eef7f3",
    textMuted: "#b4c8bf",
    border: "#2dd4bf29",
    ownRow: "#1496b452",
  },
  font: "inter",
  weight: 600,
  compact: false,
};

const GLACIER: Theme = {
  id: "glacier",
  name: "Glacier",
  tokens: {
    backgroundTint: "#f1f5f9eb",
    row: "#ffffff66",
    rowAlt: "#0f172a0a",
    header: "#0f172a14",
    accent: "#0369a1",
    text: "#0f172a",
    textMuted: "#475569",
    border: "#0f172a26",
    ownRow: "#0284c738",
  },
  font: "inter",
  weight: 600,
  compact: false,
};

const AURORA: Theme = {
  id: "aurora",
  name: "Aurora",
  tokens: {
    backgroundTint: "#0d0a1cbd",
    row: "#00000000",
    rowAlt: "#c4b5fd0d",
    header: "#c4b5fd1a",
    accent: "#f472b6",
    text: "#f3effe",
    textMuted: "#bcb3d6",
    border: "#c4b5fd26",
    ownRow: "#1496b452",
  },
  font: "oswald",
  weight: 500,
  compact: false,
};

export const THEME_PRESETS: readonly Theme[] = [
  GRAPHITE,
  MIDNIGHT,
  CARBON,
  PADDOCK,
  GLACIER,
  AURORA,
];
