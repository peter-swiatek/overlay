import type { SimName } from "@overlay/sim-core/types";

/** One metric a tile can show. Ids are stored in settings: never rename one once shipped. */
export interface MetricDef {
  id: string;
  /** Tile label, drawn in uppercase. */
  label: string;
  /** Name in the per-tile select. */
  option: string;
  /** Only these sims give the data; the select greys it out elsewhere and the tile shows "--". */
  sims?: readonly SimName[];
}

/** Every metric, in the order the per-tile select lists them. Each has real data in its sims. */
export const METRICS = [
  { id: "class-position", label: "Class Pos", option: "Class position" },
  { id: "position", label: "Position", option: "Overall position" },
  { id: "lap", label: "Lap", option: "Lap" },
  { id: "remaining", label: "Remaining", option: "Session remaining" },
  { id: "last-lap", label: "Last Lap", option: "Last lap" },
  { id: "best-lap", label: "Best Lap", option: "Best lap" },
  { id: "delta", label: "Delta", option: "Live delta" },
  { id: "brake-bias", label: "Brake Bias", option: "Brake bias" },
  { id: "fuel-level", label: "Fuel Level", option: "Fuel level" },
  { id: "fuel-laps", label: "Fuel Laps", option: "Fuel laps left" },
  { id: "energy", label: "Energy", option: "Virtual energy", sims: ["lmu"] },
  { id: "track-temp", label: "Track Temp", option: "Track temperature" },
  { id: "air-temp", label: "Air Temp", option: "Air temperature" },
  { id: "speed", label: "Speed", option: "Speed" },
  { id: "gear", label: "Gear", option: "Gear" },
  { id: "incidents", label: "Incidents", option: "Incidents", sims: ["iracing"] },
] as const satisfies readonly MetricDef[];

export type MetricId = (typeof METRICS)[number]["id"];

const BY_ID: ReadonlyMap<string, MetricDef> = new Map(METRICS.map((m) => [m.id, m]));

export function metricById(id: string): MetricDef | undefined {
  return BY_ID.get(id);
}

/** Whether the sim gives this metric's data; true while the sim is unknown. */
export function metricAvailable(def: MetricDef, sim: SimName | null): boolean {
  return def.sims === undefined || sim === null || def.sims.includes(sim);
}

/**
 * Metric of each instance on first use, by instance number - 1: the board's four tiles first,
 * then more. Instances past the end of the list copy the metric of the instance they came from.
 */
export const INSTANCE_METRICS: readonly MetricId[] = [
  "class-position",
  "brake-bias",
  "fuel-level",
  "track-temp",
  "last-lap",
  "best-lap",
  "remaining",
  "air-temp",
];
