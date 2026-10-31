import type { OverlayManifest } from "../contract";

export const demoInputsManifest: OverlayManifest = {
  id: "demo-inputs",
  title: "Inputs (demo)",
  description: "Pedal, steering and gear bars from the telemetry stream. For testing the pipeline.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 360, height: 160 },
  minSize: { width: 200, height: 120 },
  defaultPosition: { x: 60, y: 360 },
  table: false,
  fields: [],
  settings: [],
  rateHz: 60,
  defaultEnabled: false,
  dev: true,
};
