import type { OverlayManifest } from "../contract";

export const flatTrackMapManifest: OverlayManifest = {
  id: "flat-track-map",
  title: "Flat Track Map",
  description:
    "One lap as a straight bar from start/finish, with sector ticks and every car on it.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 480, height: 44 },
  minSize: { width: 200, height: 36 },
  defaultPosition: { x: 680, y: 60 },
  table: false,
  fields: [],
  settings: [
    {
      key: "labels",
      label: "Labels",
      kind: "toggle",
      default: true,
      help: "S/F and the sector names under the bar.",
      section: "Labels",
    },
    {
      key: "sector-ticks",
      label: "Sector ticks",
      kind: "toggle",
      default: true,
      help: "Only when the sim reports sector boundaries.",
      section: "Labels",
    },
    {
      key: "player-label",
      label: "Player label",
      kind: "toggle",
      default: true,
      help: "Your car number and how far round the lap you are.",
      section: "Labels",
    },
    {
      key: "mark-lapped",
      label: "Mark lapped cars",
      kind: "toggle",
      default: true,
      help: "Races only: a red ring on a car that has lapped you or is lapping you, a blue ring and a dimmed dot on a car you have lapped.",
      section: "Cars",
    },
  ],
  rateHz: 15,
  defaultEnabled: false,
};
