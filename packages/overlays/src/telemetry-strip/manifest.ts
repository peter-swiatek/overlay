import type { OverlayManifest } from "../contract";

export const telemetryStripManifest: OverlayManifest = {
  id: "telemetry-strip",
  title: "Telemetry Strip",
  description:
    "Gear with a throttle and brake ring, speed, shift lights, rpm, position, fuel, last lap and track temperature.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 609, height: 136 },
  minSize: { width: 609, height: 136 },
  defaultPosition: { x: 1280, y: 40 },
  table: false,
  fields: [
    { id: "gear-ring", label: "Throttle and brake ring", defaultVisible: true },
    { id: "speed", label: "Speed", defaultVisible: true },
    { id: "shift-lights", label: "Shift lights", defaultVisible: true },
    { id: "rpm", label: "RPM", defaultVisible: true },
    { id: "position", label: "Position", defaultVisible: true },
    { id: "fuel", label: "Fuel", defaultVisible: true },
    { id: "last-lap", label: "Last lap", defaultVisible: true },
    { id: "track-temp", label: "Track temp", defaultVisible: true },
  ],
  settings: [
    {
      key: "shift-lights",
      kind: "select",
      label: "Shift lights",
      section: "Options",
      default: "car",
      options: [
        { value: "car", label: "Car data" },
        { value: "custom", label: "Custom %" },
      ],
    },
  ],
  rateHz: 30,
  defaultEnabled: false,
  commonDefaults: { hideInGarage: true },
};
