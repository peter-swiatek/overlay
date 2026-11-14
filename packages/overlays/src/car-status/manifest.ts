import type { OverlayManifest } from "../contract";
import {
  PRESSURE_UNIT_SETTING,
  TYRE_TEMP_SOURCE_SETTING,
  TYRE_TEMP_WINDOW_SETTINGS,
} from "../tyres/manifest";

const row = (key: string, label: string, help?: string) =>
  ({
    key,
    label,
    kind: "toggle",
    section: "Corner values",
    default: true,
    ...(help === undefined ? {} : { help }),
  }) as const;

export const carStatusManifest: OverlayManifest = {
  id: "car-status",
  title: "Car Status",
  description:
    "Damage, tyres and temperatures in one panel: the car from above with its body damage and tyre temperatures, each corner's values beside it, and the engine's oil and water in the middle.",
  sims: ["lmu"],
  defaultSize: { width: 440, height: 300 },
  minSize: { width: 340, height: 240 },
  defaultPosition: { x: 1460, y: 760 },
  table: false,
  fields: [],
  settings: [
    row("show-temp", "Tyre temperature", "The average across the tyre."),
    row("show-pressure", "Tyre pressure"),
    row("show-tread", "Tread left"),
    row(
      "show-suspension",
      "Suspension damage",
      "From the game's repair screen; left out while the game does not answer.",
    ),
    row("show-brake", "Brake temperature"),
    {
      key: "show-engine",
      label: "Oil and water temperature",
      kind: "toggle",
      section: "Centre",
      default: true,
    },
    {
      key: "show-aero",
      label: "Aero damage",
      kind: "toggle",
      section: "Centre",
      default: true,
      help: "From the game's repair screen; left out while the game does not answer.",
    },
    { ...TYRE_TEMP_SOURCE_SETTING, section: "Tyres" },
    { ...PRESSURE_UNIT_SETTING, section: "Tyres" },
    ...TYRE_TEMP_WINDOW_SETTINGS,
  ],
  rateHz: 5,
  defaultEnabled: false,
};
