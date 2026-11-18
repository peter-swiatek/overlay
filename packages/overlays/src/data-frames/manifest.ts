import type { OverlayManifest } from "../contract";
import { INSTANCE_METRICS, METRICS, type MetricDef } from "./metrics";

export const DEFAULT_METRIC = INSTANCE_METRICS[0] ?? "class-position";

export const dataFramesManifest: OverlayManifest = {
  // The id is kept from the earlier multi-tile overlay so its saved first metric carries over.
  id: "data-frames",
  title: "Data Frame",
  description: "One metric in a small tile: position, lap time, brake bias, fuel and more.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 130, height: 64 },
  minSize: { width: 80, height: 40 },
  defaultPosition: { x: 1100, y: 560 },
  table: false,
  fields: [],
  settings: [
    {
      key: "metric",
      label: "Metric",
      kind: "select",
      // The earlier overlay's first tile.
      legacyKey: "tile-1",
      default: DEFAULT_METRIC,
      // Sim-limited metrics are greyed out for the other sim.
      options: METRICS.map((m: MetricDef) => ({
        value: m.id,
        label: m.option,
        ...(m.sims === undefined ? {} : { sims: m.sims }),
      })),
    },
  ],
  instanceOptions: INSTANCE_METRICS.map((metric) => ({ metric })),
  rateHz: 10,
  defaultEnabled: false,
};
