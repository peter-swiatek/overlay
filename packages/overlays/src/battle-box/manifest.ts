import type { OverlayManifest } from "../contract";
// Pure files only: the desktop main process type-checks manifests without JSX.
import { driverFields, type DriverFieldId } from "../shared/fields";
import { TABLE_OPTION_FIELDS } from "../shared/options";

/** The columns the Battle Box offers, in default order (design: Pos, Car, Driver, iR, Last, Int). */
const COLUMN_IDS: readonly DriverFieldId[] = [
  "position",
  "car-number",
  "driver",
  "licence",
  "irating",
  "last-lap",
  "best-lap",
  "last-lap-delta",
  "interval",
  "pit-lane",
  "flag",
];

const DEFAULT_VISIBLE: readonly DriverFieldId[] = [
  "position",
  "car-number",
  "driver",
  "irating",
  "last-lap",
  "interval",
];

/**
 * Window width that fits the default columns at the nominal metrics, rounded up (the design is
 * 400 wide with 2-decimal lap times; the 3-decimal Last column needs the extra width).
 * battle-box.test.tsx asserts it equals the computed fit.
 */
const DEFAULT_WIDTH = 437;

export const battleBoxManifest: OverlayManifest = {
  id: "battle-box",
  title: "Battle Box",
  description:
    "The car ahead and the car behind in your class, with the gaps at the line and sector-by-sector time against each.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: DEFAULT_WIDTH, height: 150 },
  minSize: { width: 260, height: 80 },
  defaultPosition: { x: 680, y: 320 },
  table: true,
  fields: driverFields(COLUMN_IDS, DEFAULT_VISIBLE),
  settings: [
    ...TABLE_OPTION_FIELDS,
    {
      key: "sector-strips",
      label: "Sector strips",
      kind: "toggle",
      section: "Layout",
      default: true,
      help: "Between the rows: your latest time in each sector against the other car's, green where you were faster.",
    },
    {
      key: "row-labels",
      label: "Show row labels",
      kind: "toggle",
      section: "Layout",
      default: true,
    },
    {
      key: "gap-threat",
      label: "Gap threat colours",
      kind: "toggle",
      section: "Drivers",
      default: true,
      help: "Gap of the car behind: red within 1.0 s, yellow within 2.0 s.",
    },
    {
      key: "irating-change",
      label: "iRating change",
      kind: "toggle",
      section: "Drivers",
      default: false,
      help: "Wide iRating pill with the projected change right-aligned.",
      sims: ["iracing"],
    },
  ],
  rateHz: 10,
  defaultEnabled: false,
};
