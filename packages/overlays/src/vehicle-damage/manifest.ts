import type { OverlayManifest } from "../contract";

export const vehicleDamageManifest: OverlayManifest = {
  id: "vehicle-damage",
  title: "Vehicle Damage",
  description:
    "Your car from above with the sim's damage on it: dents round the body in green, yellow or red, flat tyres, a status pill, and when the last hit was.",
  sims: ["lmu"],
  defaultSize: { width: 220, height: 260 },
  minSize: { width: 160, height: 190 },
  defaultPosition: { x: 1680, y: 360 },
  table: false,
  fields: [],
  settings: [
    {
      key: "hide-clean",
      label: "Hide when undamaged",
      kind: "toggle",
      section: "Panel",
      default: false,
      help: "Off: the panel stays on screen with a green car while nothing is damaged.",
    },
    {
      key: "show-details",
      label: "Details under the car",
      kind: "toggle",
      section: "Panel",
      default: true,
      help: "Front and rear damage, flat tyres and how long ago the last hit was.",
    },
  ],
  rateHz: 5,
  defaultEnabled: false,
};
