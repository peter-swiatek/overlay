import type { OverlayManifest } from "../contract";
// Pure files only: the desktop main process type-checks manifests without JSX.
import { driverFields, type DriverFieldId } from "../shared/fields";
import { tableOptionFields } from "../shared/options";

/** The Relative's row pieces, in the design's order: Pos, Car, Driver, SR, iR, Gap. */
const COLUMN_IDS: readonly DriverFieldId[] = [
  "position",
  "car-number",
  "driver",
  "licence",
  "irating",
  "gap",
];

/**
 * Window width that fits the default columns at the nominal metrics, rounded up (the design is
 * 320 wide; the Relative's columns need more). overtake-alert.test.tsx asserts it equals the
 * computed fit.
 */
const DEFAULT_WIDTH = 428;

export const overtakeAlertManifest: OverlayManifest = {
  id: "overtake-alert",
  title: "Overtake Alert",
  description:
    "Faster-class cars closing on you from behind: each one rises from the bottom of the window to the top as its gap shrinks.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: DEFAULT_WIDTH, height: 80 },
  minSize: { width: 200, height: 30 },
  defaultPosition: { x: 680, y: 480 },
  table: true,
  fields: driverFields(COLUMN_IDS, COLUMN_IDS),
  settings: [
    ...tableOptionFields(["column-width", "width-fine-tune", "name-display", "name-format"]),
    {
      key: "window-seconds",
      label: "Warn within",
      kind: "number",
      section: "Alert",
      default: 5,
      min: 2,
      max: 10,
      step: 0.5,
      unit: "s",
      help: "Cars this far behind or closer show. A car appears at the bottom at this gap and rises to the top as it closes.",
    },
    {
      key: "max-rows",
      label: "Most cars shown",
      kind: "number",
      section: "Alert",
      default: 2,
      min: 1,
      max: 4,
      step: 1,
      help: "The closest cars win.",
    },
    {
      key: "same-class",
      label: "Include my class",
      kind: "toggle",
      section: "Alert",
      default: false,
      help: "Also show cars of your own class closing from behind. Off: faster classes only.",
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
