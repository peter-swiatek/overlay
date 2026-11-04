import type { SimName } from "@overlay/sim-core/types";
import type { FieldConfig } from "@overlay/ui/types";
import type { OverlayFieldDef } from "../contract";

export const DRIVER_FIELD_IDS = [
  "position",
  "overall-position",
  "car-number",
  "car-class",
  "driver",
  "licence",
  "irating",
  "gap",
  "interval",
  "last-lap",
  "best-lap",
  "avg-lap",
  "last-lap-delta",
  "best-lap-delta",
  "lap",
  "pit-lane",
  "pit-stall",
  "last-pitted",
  "stint-lap",
  "prev-stint",
  "pos-change",
  "energy",
  "p2p",
  "flag",
] as const;
export type DriverFieldId = (typeof DRIVER_FIELD_IDS)[number];

type FieldSpec = Omit<OverlayFieldDef, "id">;

/** Hide order of the optional columns when the table is narrow (fit.ts). */
const DROP_PRIORITY: Partial<Record<DriverFieldId, number>> = {
  energy: 10,
  "prev-stint": 12,
  "stint-lap": 14,
  "last-pitted": 16,
  "pit-stall": 18,
  lap: 20,
  p2p: 22,
  "avg-lap": 24,
  "best-lap-delta": 26,
  "last-lap-delta": 28,
  "overall-position": 30,
  "car-class": 32,
  "pos-change": 34,
  flag: 38,
  "pit-lane": 36,
  "best-lap": 40,
  licence: 50,
  irating: 55,
  interval: 60,
  "last-lap": 70,
};

const SPECS: Record<DriverFieldId, FieldSpec> = {
  position: { label: "Position", defaultVisible: true, defaultWidthPct: 6, chars: 3 },
  "overall-position": {
    label: "Overall position",
    defaultVisible: false,
    defaultWidthPct: 6,
    chars: 3,
  },
  "car-number": { label: "Car number", defaultVisible: true, defaultWidthPct: 7, chars: 4 },
  "car-class": { label: "Car class", defaultVisible: false, defaultWidthPct: 9, chars: 6 },
  driver: {
    label: "Driver name",
    defaultVisible: true,
    defaultWidthPct: 30,
    chars: 14,
    minChars: 10,
  },
  licence: {
    label: "Safety rating",
    defaultVisible: true,
    defaultWidthPct: 9,
    sims: ["iracing"],
    chars: 7,
  },
  irating: {
    label: "iRating",
    defaultVisible: true,
    defaultWidthPct: 8,
    sims: ["iracing"],
    chars: 8,
  },
  gap: { label: "Gap", defaultVisible: true, defaultWidthPct: 9, chars: 6 },
  interval: { label: "Interval", defaultVisible: true, defaultWidthPct: 9, chars: 6 },
  "last-lap": { label: "Last lap", defaultVisible: true, defaultWidthPct: 10, chars: 8 },
  "best-lap": { label: "Best lap", defaultVisible: true, defaultWidthPct: 10, chars: 8 },
  "avg-lap": { label: "Avg lap", defaultVisible: false, defaultWidthPct: 10, chars: 8 },
  "last-lap-delta": {
    label: "Last lap delta",
    defaultVisible: false,
    defaultWidthPct: 8,
    chars: 6,
  },
  "best-lap-delta": {
    label: "Best lap delta",
    defaultVisible: false,
    defaultWidthPct: 8,
    chars: 6,
  },
  lap: { label: "Lap number", defaultVisible: false, defaultWidthPct: 5, chars: 3 },
  "pit-lane": { label: "Pit lane", defaultVisible: true, defaultWidthPct: 5, chars: 3 },
  "pit-stall": { label: "Pit stall", defaultVisible: false, defaultWidthPct: 6, chars: 5 },
  "last-pitted": { label: "Last pitted", defaultVisible: false, defaultWidthPct: 6, chars: 4 },
  "stint-lap": { label: "Stint lap", defaultVisible: false, defaultWidthPct: 5, chars: 3 },
  "prev-stint": { label: "Prev stint", defaultVisible: false, defaultWidthPct: 5, chars: 3 },
  "pos-change": { label: "Pos change", defaultVisible: false, defaultWidthPct: 6, chars: 4 },
  energy: {
    label: "Fuel % (LMU)",
    defaultVisible: false,
    defaultWidthPct: 6,
    sims: ["lmu"],
    chars: 4,
  },
  p2p: {
    label: "Push to pass",
    defaultVisible: false,
    defaultWidthPct: 5,
    sims: ["iracing"],
    chars: 3,
  },
  flag: { label: "Flag / penalty", defaultVisible: false, defaultWidthPct: 6, chars: 5 },
};

/** Short header labels, so a column's header fits at its floor width (the settings UI keeps the long names). */
export const SHORT_LABEL: Record<DriverFieldId, string> = {
  position: "Pos",
  "overall-position": "Ovr",
  "car-number": "Car",
  "car-class": "Class",
  driver: "Driver",
  licence: "SR",
  irating: "iR",
  gap: "Gap",
  interval: "Int",
  "last-lap": "Last",
  "best-lap": "Best",
  "avg-lap": "Avg",
  "last-lap-delta": "ΔLast",
  "best-lap-delta": "ΔBest",
  lap: "Lap",
  "pit-lane": "Pit",
  "pit-stall": "Stall",
  "last-pitted": "LPit",
  "stint-lap": "Stint",
  "prev-stint": "Prev",
  "pos-change": "+/-",
  energy: "Fuel",
  p2p: "P2P",
  flag: "Flag",
};

/** Characters a header needs; capitals are wider than the digit the `ch` unit measures. */
export function labelChars(label: string): number {
  return Math.ceil(label.length * 1.2);
}

/**
 * Narrowest a driver column may get, in characters: `max(minChars ?? chars, header label chars)`.
 * The overlay's grid and the settings width slider both use it. Undefined for an unknown id.
 */
export function columnFloorChars(fieldId: string): number | undefined {
  const spec = (SPECS as Partial<Record<string, FieldSpec>>)[fieldId];
  const label = (SHORT_LABEL as Partial<Record<string, string>>)[fieldId];
  if (spec === undefined || label === undefined) return undefined;
  const base = spec.minChars ?? spec.chars;
  return Math.max(base ?? 0, LABEL_FLOOR_CHARS[fieldId] ?? labelChars(label));
}

/**
 * Header floors measured rather than estimated: the small uppercase "POS" label fits in the
 * 3 characters the position digits need, so the column stays as narrow as the design's.
 */
const LABEL_FLOOR_CHARS: Readonly<Record<string, number>> = { position: 3 };

/** Every driver column, in this order, with the reference labels and default widths. defaultVisible = Leaderboard defaults. */
export const DRIVER_FIELDS: readonly OverlayFieldDef[] = DRIVER_FIELD_IDS.map((id) => ({
  id,
  ...SPECS[id],
  dropPriority: DROP_PRIORITY[id],
}));

/** A subset in the given order with defaultVisible taken from `visible`. Throws on an unknown id (a bug). */
export function driverFields(
  ids: readonly DriverFieldId[],
  visible: readonly DriverFieldId[],
): OverlayFieldDef[] {
  return ids.map((id) => {
    const spec = (SPECS as Partial<Record<string, FieldSpec>>)[id];
    if (spec === undefined) throw new Error(`Unknown driver field id: ${String(id)}`);
    return { id, ...spec, dropPriority: DROP_PRIORITY[id], defaultVisible: visible.includes(id) };
  });
}

/** The field config without the columns that only exist in another sim (no empty iRating column in LMU). Unknown sim keeps all. */
export function fieldsForSim(config: readonly FieldConfig[], sim: SimName | null): FieldConfig[] {
  if (sim === null) return [...config];
  return config.filter((f) => {
    const sims = DRIVER_FIELDS.find((d) => d.id === f.id)?.sims;
    return sims === undefined || sims.includes(sim);
  });
}
