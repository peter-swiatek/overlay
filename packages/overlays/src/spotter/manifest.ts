import type { OverlayManifest } from "../contract";

export const spotterManifest: OverlayManifest = {
  id: "spotter",
  title: "Spotter",
  description: "Shows which side a car is alongside.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 360, height: 160 },
  minSize: { width: 120, height: 60 },
  defaultPosition: { x: 780, y: 420 },
  table: false,
  fields: [],
  settings: [],
  rateHz: 30,
  defaultEnabled: true,
};
