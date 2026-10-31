import type { OverlayManifest } from "../contract";

export const relativeManifest: OverlayManifest = {
  id: "relative",
  title: "Relative",
  description: "Cars around you on track, with the gap to each.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 420, height: 300 },
  minSize: { width: 260, height: 140 },
  defaultPosition: { x: 40, y: 600 },
  table: true,
  fields: [],
  settings: [],
  rateHz: 10,
  defaultEnabled: true,
};
