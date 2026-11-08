import type { OverlayManifest } from "../contract";

export const weatherManifest: OverlayManifest = {
  id: "weather",
  title: "Weather",
  description: "Heading-up wind compass, temperatures, humidity, rain, track usage and wetness.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 200, height: 352 },
  minSize: { width: 180, height: 120 },
  defaultPosition: { x: 1640, y: 200 },
  table: false,
  fields: [
    { id: "compass", label: "Wind compass", defaultVisible: true, sims: ["iracing"] },
    { id: "track-temp", label: "Track temp", defaultVisible: true },
    { id: "air-temp", label: "Air temp", defaultVisible: true },
    { id: "wind", label: "Wind", defaultVisible: true, sims: ["iracing"] },
    { id: "humidity", label: "Humidity", defaultVisible: true, sims: ["iracing"] },
    { id: "rain", label: "Rain", defaultVisible: true, sims: ["iracing"] },
    { id: "usage", label: "Track usage", defaultVisible: true, sims: ["iracing"] },
    { id: "wetness", label: "Track wetness", defaultVisible: true },
  ],
  settings: [],
  rateHz: 10,
  defaultEnabled: false,
};
