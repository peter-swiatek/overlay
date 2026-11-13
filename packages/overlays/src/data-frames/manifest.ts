import type { OverlayManifest, SettingField } from "../contract";
import { DEFAULT_TILE_METRICS, MAX_TILES, METRICS, tileKey, type MetricDef } from "./metrics";

// Sim-limited metrics are greyed out in the select for the other sim.
const metricOptions = METRICS.map((m: MetricDef) => ({
  value: m.id,
  label: m.option,
  ...(m.sims === undefined ? {} : { sims: m.sims }),
}));

const tileSettings: SettingField[] = DEFAULT_TILE_METRICS.slice(0, MAX_TILES).map((metric, i) => ({
  key: tileKey(i + 1),
  label: `Tile ${i + 1}`,
  kind: "select",
  section: "Tiles",
  default: metric,
  options: metricOptions,
  ...(i >= 1 ? { help: `Shown when Tiles is ${i + 1} or more.` } : {}),
}));

export const dataFramesManifest: OverlayManifest = {
  id: "data-frames",
  title: "Data Frames",
  description:
    "Single-metric tiles you choose: positions, lap times, brake bias, fuel, temperatures and more, each in its own small panel.",
  sims: ["iracing", "lmu"],
  // Four 130 x 64 tiles in two columns with 12 px between them.
  defaultSize: { width: 272, height: 140 },
  minSize: { width: 64, height: 32 },
  defaultPosition: { x: 1100, y: 560 },
  table: false,
  fields: [],
  settings: [
    {
      key: "tiles",
      label: "Tiles",
      kind: "number",
      section: "Layout",
      default: 4,
      min: 1,
      max: MAX_TILES,
      step: 1,
      help: "How many tiles to show. They share the window, so resize it to fit.",
    },
    {
      key: "columns",
      label: "Columns",
      kind: "number",
      section: "Layout",
      default: 2,
      min: 1,
      max: MAX_TILES,
      step: 1,
    },
    {
      key: "gap",
      label: "Gap between tiles",
      kind: "number",
      section: "Layout",
      default: 12,
      min: 0,
      max: 32,
      step: 1,
      unit: "px",
    },
    ...tileSettings,
  ],
  rateHz: 10,
  defaultEnabled: false,
};
