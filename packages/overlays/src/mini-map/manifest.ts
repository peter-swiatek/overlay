import type { OverlayManifest } from "../contract";

export const miniMapManifest: OverlayManifest = {
  id: "mini-map",
  title: "Mini Map",
  description:
    "The stretch of track around you, turned to your direction of travel, with nearby cars.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 240, height: 240 },
  minSize: { width: 140, height: 140 },
  defaultPosition: { x: 440, y: 560 },
  table: false,
  fields: [],
  settings: [
    {
      key: "zoom",
      label: "Zoom",
      kind: "number",
      default: 150,
      min: 100,
      max: 300,
      step: 25,
      unit: "%",
      help: "100 % shows 300 m to the outer ring, 300 % shows 100 m.",
      section: "Map",
    },
    {
      key: "orientation",
      label: "Orientation",
      kind: "select",
      default: "heading-up",
      options: [
        { value: "heading-up", label: "Heading up" },
        { value: "north-up", label: "North up" },
      ],
      help: "Heading up turns the map so your direction of travel points up.",
      section: "Map",
    },
    {
      key: "car-labels",
      label: "Car labels",
      kind: "toggle",
      default: true,
      section: "Labels",
    },
    {
      key: "gap",
      label: "Gap to you in labels",
      kind: "toggle",
      default: true,
      section: "Labels",
    },
  ],
  rateHz: 15,
  defaultEnabled: false,
};
