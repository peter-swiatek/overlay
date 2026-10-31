import type { OverlayManifest } from "../contract";

export const fuelManifest: OverlayManifest = {
  id: "fuel",
  title: "Fuel Calculator",
  description: "Fuel use, laps remaining and what to add.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 520, height: 230 },
  minSize: { width: 280, height: 120 },
  defaultPosition: { x: 1360, y: 820 },
  table: false,
  fields: [],
  settings: [],
  rateHz: 5,
  defaultEnabled: true,
};
