import type { OverlayManifest } from "../contract";

const celsius = (key: string, label: string, value: number, help: string) =>
  ({
    key,
    label,
    kind: "number",
    section: "Temperature window",
    default: value,
    min: 20,
    max: 200,
    step: 1,
    help,
  }) as const;

const percent = (key: string, label: string, value: number, help: string) =>
  ({
    key,
    label,
    kind: "number",
    section: "Tread",
    default: value,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    help,
  }) as const;

export const tyresManifest: OverlayManifest = {
  id: "tyres",
  title: "Tyres",
  description:
    "Four-corner tyre panel: compound and laps on the set, tread left, temperatures across each tyre, pressure and brake temperature.",
  sims: ["lmu"],
  defaultSize: { width: 260, height: 220 },
  minSize: { width: 200, height: 150 },
  defaultPosition: { x: 1640, y: 640 },
  table: false,
  fields: [],
  settings: [
    {
      key: "temp-source",
      label: "Tyre temperatures",
      kind: "select",
      section: "Layout",
      default: "inner-layer",
      options: [
        { value: "inner-layer", label: "Under the tread" },
        { value: "surface", label: "Surface" },
      ],
      help: "Outer, middle and inner. Under the tread follows the rubber's core and moves slowly; the surface jumps with every corner.",
    },
    {
      key: "pressure-unit",
      label: "Pressure unit",
      kind: "select",
      section: "Layout",
      default: "auto",
      options: [
        { value: "auto", label: "From Units (kPa or psi)" },
        { value: "kpa", label: "kPa" },
        { value: "bar", label: "bar" },
        { value: "psi", label: "psi" },
      ],
    },
    {
      key: "show-compound",
      label: "Compound and laps on set",
      kind: "toggle",
      section: "Layout",
      default: true,
    },
    {
      key: "show-brakes",
      label: "Brake temperature",
      kind: "toggle",
      section: "Layout",
      default: true,
    },
    celsius("temp-cold", "Cold below (°C)", 70, "Blue when the tyre's average is below this."),
    celsius("temp-hot", "Hot above (°C)", 95, "Yellow when the hottest point is above this."),
    celsius(
      "temp-overheat",
      "Overheating above (°C)",
      105,
      "Red when the hottest point is above this.",
    ),
    percent("tread-warn", "Worn below", 60, "Tread left turns yellow below this."),
    percent("tread-critical", "Critical below", 35, "Tread left turns red below this."),
  ],
  rateHz: 5,
  defaultEnabled: false,
};
