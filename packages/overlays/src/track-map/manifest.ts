import type { OverlayManifest } from "../contract";

export const trackMapManifest: OverlayManifest = {
  id: "track-map",
  title: "Track Map",
  description: "The track outline with every car on it, sector lines and corner labels.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 360, height: 300 },
  minSize: { width: 160, height: 120 },
  defaultPosition: { x: 60, y: 560 },
  table: false,
  fields: [],
  settings: [
    {
      key: "corner-labels",
      label: "Corner labels",
      kind: "toggle",
      default: true,
      help: "Only on tracks with a corner list.",
      section: "Labels",
    },
    {
      key: "car-numbers",
      label: "Car numbers",
      kind: "toggle",
      default: true,
      section: "Labels",
    },
  ],
  rateHz: 15,
  defaultEnabled: false,
};
