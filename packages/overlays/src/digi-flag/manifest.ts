import type { OverlayManifest } from "../contract";

export const digiFlagManifest: OverlayManifest = {
  id: "digi-flag",
  title: "Digi Flag",
  description:
    "A digital marshalling panel: your current flag on a grid of LEDs, with a caption. iRacing shows every flag; LMU shows green, local yellow and blue.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 120, height: 120 },
  minSize: { width: 80, height: 80 },
  defaultPosition: { x: 1760, y: 120 },
  table: false,
  fields: [],
  settings: [
    {
      key: "hide-idle",
      label: "Hide when no flag",
      kind: "toggle",
      section: "Panel",
      default: false,
      help: "Off: the panel stays on screen with dim LEDs while no flag is out.",
    },
    {
      key: "blink",
      label: "Blink yellow and blue",
      kind: "toggle",
      section: "Panel",
      default: false,
      help: "Blinks the LEDs for a local yellow, a safety car and a blue flag.",
    },
    {
      key: "green-seconds",
      label: "Green shows for",
      kind: "number",
      section: "Panel",
      default: 5,
      min: 0,
      max: 30,
      step: 1,
      unit: "s",
      help: "Green shows this long at a start or when a caution clears, then the panel goes dark. 0 never shows green.",
    },
  ],
  rateHz: 10,
  defaultEnabled: false,
};
