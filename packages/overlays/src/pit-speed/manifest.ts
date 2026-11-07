import type { OverlayManifest } from "../contract";

export const pitSpeedManifest: OverlayManifest = {
  id: "pit-speed",
  title: "Pit Speed",
  description: "Your speed against the pit lane limit.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 240, height: 48 },
  minSize: { width: 160, height: 36 },
  defaultPosition: { x: 820, y: 120 },
  table: false,
  // The reference lists only "Pit stop info"; the other three let the user trim the widget.
  // The distance part of "pit-stop-info" is iRacing only, so the field keeps both sims.
  fields: [
    { id: "speed", label: "Speed", defaultVisible: true },
    { id: "limit", label: "Limit", defaultVisible: true },
    { id: "limiter", label: "Limiter", defaultVisible: true },
    { id: "pit-stop-info", label: "Pit stop info", defaultVisible: true },
  ],
  settings: [],
  rateHz: 20,
  defaultEnabled: true,
};
