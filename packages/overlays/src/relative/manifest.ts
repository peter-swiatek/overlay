import type { OverlayManifest } from "../contract";
import { DRIVER_FIELD_IDS, driverFields, type DriverFieldId } from "../shared/fields";
import { HEADER_FIELD_OPTIONS } from "../shared/info";
import { TABLE_OPTION_FIELDS } from "../shared/options";

// Reference: "as Leaderboard, minus class and overall columns", in kit order.
const COLUMN_IDS: readonly DriverFieldId[] = DRIVER_FIELD_IDS.filter(
  (id) => id !== "overall-position" && id !== "car-class",
);

const DEFAULT_VISIBLE: readonly DriverFieldId[] = [
  "position",
  "car-number",
  "driver",
  "licence",
  "irating",
  "gap",
];

/**
 * Window width that fits the default columns at the nominal metrics, rounded up.
 * relative.test.tsx asserts it equals the computed fit.
 */
const DEFAULT_WIDTH = 428;

export const relativeManifest: OverlayManifest = {
  id: "relative",
  title: "Relative",
  description: "Cars around you on track, with the gap to each.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: DEFAULT_WIDTH, height: 300 },
  minSize: { width: 260, height: 140 },
  defaultPosition: { x: 40, y: 600 },
  table: true,
  fields: driverFields(COLUMN_IDS, DEFAULT_VISIBLE),
  settings: [
    ...TABLE_OPTION_FIELDS,
    {
      key: "drivers-ahead",
      label: "Drivers ahead",
      kind: "number",
      section: "Drivers",
      default: 3,
      min: 0,
      max: 8,
      step: 1,
    },
    {
      key: "drivers-behind",
      label: "Drivers behind",
      kind: "number",
      section: "Drivers",
      default: 3,
      min: 0,
      max: 8,
      step: 1,
    },
    {
      key: "hide-in-pits",
      label: "Hide cars in pits",
      kind: "toggle",
      section: "Drivers",
      default: false,
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
    {
      key: "lap-colours",
      label: "Colour by car status",
      kind: "toggle",
      section: "Drivers",
      default: true,
      help: "Driver name and Rel gap in one colour per car: red for a car that has lapped you or is lapping you, blue for a car you have lapped or are lapping, white on the same lap (lap colours in races only), muted while the car is in the pits.",
    },
    {
      key: "weather-header",
      label: "Weather header",
      kind: "toggle",
      section: "Layout",
      default: true,
    },
    {
      key: "row-labels",
      label: "Show row labels",
      kind: "toggle",
      section: "Layout",
      default: true,
    },
    {
      key: "session-footer",
      label: "Session footer",
      kind: "toggle",
      section: "Layout",
      default: true,
    },
    { key: "flag-border", label: "Flag border", kind: "toggle", section: "Layout", default: false },
    {
      key: "show-dq-limit",
      label: "Show DQ limit",
      kind: "toggle",
      section: "Layout",
      default: true,
      help: "Incidents show / limit when the session has one.",
      sims: ["iracing"],
    },
    {
      key: "header-fields",
      label: "Header fields",
      kind: "multi",
      section: "Header and footer",
      default: ["air-temp", "track-temp", "wetness", "wind"],
      options: HEADER_FIELD_OPTIONS,
      max: 5,
    },
    {
      key: "footer-fields",
      label: "Footer fields",
      kind: "multi",
      section: "Header and footer",
      default: ["session-remaining", "incidents", "sof"],
      options: HEADER_FIELD_OPTIONS,
      max: 5,
    },
  ],
  rateHz: 10,
  defaultEnabled: true,
};
