import type { OverlayManifest } from "../contract";

export const pitSpeedManifest: OverlayManifest = {
  id: "pit-speed",
  title: "Pit Speed",
  description: "Your speed against the pit lane limit.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 280, height: 110 },
  minSize: { width: 180, height: 70 },
  defaultPosition: { x: 820, y: 120 },
  table: false,
  fields: [],
  settings: [],
  rateHz: 20,
  defaultEnabled: true,
};
