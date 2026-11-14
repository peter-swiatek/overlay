import type { OverlayManifest } from "../contract";

export const setupCompareManifest: OverlayManifest = {
  id: "setup-compare",
  title: "Setup Compare",
  description:
    "Your baseline car setup against the one loaded now: best lap, 5-lap average and sector times with deltas, plus top speed and fuel per lap. Only valid laps count.",
  // Only iRacing names the loaded setup.
  sims: ["iracing"],
  defaultSize: { width: 340, height: 210 },
  minSize: { width: 240, height: 110 },
  defaultPosition: { x: 1360, y: 470 },
  table: false,
  fields: [],
  settings: [
    {
      key: "pin-baseline",
      label: "Pin baseline",
      kind: "toggle",
      section: "Baseline",
      default: false,
      help: "Turning this on makes the setup loaded now the baseline for this car and track, also in later sessions; a car and track without one pins its first setup with a valid lap. To pin another setup, load it and turn this off and on again. Off: the baseline is the first setup you complete a valid lap with this session.",
    },
    {
      key: "show-sectors",
      label: "Sector times",
      kind: "toggle",
      section: "Layout",
      default: true,
      help: "Best time in each of the track's official sectors.",
    },
    {
      key: "show-footer",
      label: "Top speed and fuel",
      kind: "toggle",
      section: "Layout",
      default: true,
      help: "Top speed: the change in the average top speed of the last 5 valid laps. Fuel: the active setup's average use over its last 5 valid laps, with the change in brackets.",
    },
  ],
  rateHz: 5,
  defaultEnabled: false,
};
