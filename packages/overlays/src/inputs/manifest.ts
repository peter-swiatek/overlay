import type { OverlayManifest } from "../contract";

export const inputsManifest: OverlayManifest = {
  id: "inputs",
  title: "Inputs",
  description: "Throttle, brake, clutch and steering traces with pedal bars, gear and speed.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 556, height: 120 },
  minSize: { width: 556, height: 120 },
  defaultPosition: { x: 40, y: 910 },
  table: false,
  fields: [
    { id: "hub", label: "Gear and speed", defaultVisible: true },
    { id: "trace", label: "Trace", defaultVisible: true },
    { id: "bars", label: "Pedal bars", defaultVisible: true },
  ],
  settings: [
    {
      key: "trace-seconds",
      kind: "number",
      label: "Trace length",
      section: "Layout",
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      unit: "s",
    },
    {
      key: "show-clutch",
      kind: "toggle",
      label: "Clutch",
      section: "Layout",
      default: true,
    },
    {
      key: "show-steering-trace",
      kind: "toggle",
      label: "Steering trace",
      section: "Layout",
      default: true,
    },
  ],
  rateHz: 60,
  defaultEnabled: false,
  commonDefaults: { hideInGarage: true },
};
