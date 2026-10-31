import type { OverlayManifest } from "../contract";

export const leaderboardManifest: OverlayManifest = {
  id: "leaderboard",
  title: "Leaderboard",
  description: "Standings for the whole field.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 560, height: 440 },
  minSize: { width: 300, height: 160 },
  defaultPosition: { x: 40, y: 40 },
  table: true,
  fields: [],
  settings: [],
  rateHz: 5,
  defaultEnabled: true,
};
