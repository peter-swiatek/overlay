import type { OverlayManifest } from "../contract";

/**
 * Not mapped in M2: The reference "Max basis: Session / Tank" select (its two values are not described
 * anywhere we can see). Usage bars use fuelMaxLap instead; see view.ts.
 * Append new settings at the end of the list (M2-20 adds `keep-fuel-data`, section "Fuel").
 */
export const fuelManifest: OverlayManifest = {
  id: "fuel",
  title: "Fuel Calculator",
  description: "Fuel use, laps remaining and what to add.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 380, height: 420 },
  minSize: { width: 280, height: 120 },
  defaultPosition: { x: 1360, y: 560 },
  table: false,
  fields: [
    { id: "consumption", label: "Consumption", defaultVisible: true },
    { id: "fuel-history", label: "Fuel history", defaultVisible: false },
    { id: "fuel-level", label: "Fuel level", defaultVisible: true },
    { id: "targets", label: "Fuel-to-finish targets", defaultVisible: true },
    { id: "laps-left", label: "Laps left avg / last / worst", defaultVisible: true },
    { id: "laps-remaining", label: "Laps remaining", defaultVisible: true },
    { id: "pit-window", label: "Pit window", defaultVisible: true },
    { id: "refuel", label: "Refuel amount", defaultVisible: true },
    { id: "usage", label: "Usage avg 10 / avg 5 / last", defaultVisible: true },
  ],
  settings: [
    {
      key: "layout",
      label: "Layout",
      kind: "select",
      section: "Fuel",
      default: "vertical",
      options: [
        { value: "vertical", label: "Vertical" },
        { value: "horizontal", label: "Horizontal" },
      ],
    },
    {
      key: "safety-margin",
      label: "Safety margin",
      kind: "number",
      section: "Fuel",
      default: 1,
      min: 0,
      max: 5,
      step: 0.5,
      unit: "laps",
    },
    {
      key: "live-updates",
      label: "Live fuel updates",
      kind: "toggle",
      section: "Fuel",
      default: true,
      help: "Update targets continuously, not only at the start/finish line.",
    },
    // The reference does not show its default; off is the conservative choice.
    {
      key: "keep-fuel-data",
      label: "Keep fuel data",
      kind: "toggle",
      section: "Fuel",
      default: false,
      help: "Start each session with your last 10 valid laps of fuel use in this car at this track.",
    },
  ],
  rateHz: 5,
  defaultEnabled: true,
};
