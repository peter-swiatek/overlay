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
] as const;
export type DriverFieldId = (typeof DRIVER_FIELD_IDS)[number];

type FieldSpec = Omit<OverlayFieldDef, "id">;

const SPECS: Record<DriverFieldId, FieldSpec> = {
  position: { label: "Position", defaultVisible: true, defaultWidthPct: 6 },
  "overall-position": { label: "Overall position", defaultVisible: false, defaultWidthPct: 6 },
  "car-number": { label: "Car number", defaultVisible: true, defaultWidthPct: 7 },
  "car-class": { label: "Car class", defaultVisible: false, defaultWidthPct: 9 },
  driver: { label: "Driver name", defaultVisible: true, defaultWidthPct: 30 },
  licence: { label: "Safety rating", defaultVisible: true, defaultWidthPct: 9, sims: ["iracing"] },
  irating: { label: "iRating", defaultVisible: true, defaultWidthPct: 8, sims: ["iracing"] },
  gap: { label: "Gap", defaultVisible: true, defaultWidthPct: 9 },
  interval: { label: "Interval", defaultVisible: true, defaultWidthPct: 9 },
  "last-lap": { label: "Last lap", defaultVisible: true, defaultWidthPct: 10 },
  "best-lap": { label: "Best lap", defaultVisible: true, defaultWidthPct: 10 },
  "avg-lap": { label: "Avg lap", defaultVisible: false, defaultWidthPct: 10 },
  "last-lap-delta": { label: "Last lap delta", defaultVisible: false, defaultWidthPct: 8 },
  "best-lap-delta": { label: "Best lap delta", defaultVisible: false, defaultWidthPct: 8 },
  lap: { label: "Lap number", defaultVisible: false, defaultWidthPct: 5 },
  "pit-lane": { label: "Pit lane", defaultVisible: true, defaultWidthPct: 5 },
  "pit-stall": { label: "Pit stall", defaultVisible: false, defaultWidthPct: 6 },
  "last-pitted": { label: "Last pitted", defaultVisible: false, defaultWidthPct: 6 },
  "stint-lap": { label: "Stint lap", defaultVisible: false, defaultWidthPct: 5 },
  "prev-stint": { label: "Prev stint", defaultVisible: false, defaultWidthPct: 5 },
  "pos-change": { label: "Pos change", defaultVisible: false, defaultWidthPct: 6 },
  energy: { label: "Energy % (LMU)", defaultVisible: false, defaultWidthPct: 6, sims: ["lmu"] },
};

/** Every driver column, in this order, with the reference labels and default widths. defaultVisible = Leaderboard defaults. */
export const DRIVER_FIELDS: readonly OverlayFieldDef[] = DRIVER_FIELD_IDS.map((id) => ({
  id,
  ...SPECS[id],
}));

/** A subset in the given order with defaultVisible taken from `visible`. Throws on an unknown id (a bug). */
export function driverFields(
  ids: readonly DriverFieldId[],
  visible: readonly DriverFieldId[],
): OverlayFieldDef[] {
  return ids.map((id) => {
    const spec = (SPECS as Partial<Record<string, FieldSpec>>)[id];
    if (spec === undefined) throw new Error(`Unknown driver field id: ${String(id)}`);
    return { id, ...spec, defaultVisible: visible.includes(id) };
  });
}
