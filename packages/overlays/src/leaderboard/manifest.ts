import type { OverlayManifest, SettingField } from "../contract";
// Pure files only: the desktop main process type-checks manifests without JSX.
import { DRIVER_FIELD_IDS, driverFields, type DriverFieldId } from "../shared/fields";
import { HEADER_FIELD_OPTIONS } from "../shared/info";
import { TABLE_OPTION_FIELDS } from "../shared/options";

// Not yet (no data or asset in the app): driver tag (needs a tagged-drivers list), manufacturer
// logo (needs a logo set and a car-to-make table), driver indicator (not defined by the design
// hand-off), and the overall car count with the helmet in the header strip (strip values are text).
// The projected iRating change already shows in the iRating pill.
const LEADERBOARD_DEFAULT_VISIBLE: readonly DriverFieldId[] = [
  "position",
  "car-number",
  "driver",
  "licence",
  "irating",
  "gap",
  "interval",
  "last-lap",
];

/**
 * The shared table options, with an extra name layout for team races: the team on top and the
 * driver in smaller text underneath, on taller rows.
 */
const LEADERBOARD_TABLE_FIELDS: SettingField[] = TABLE_OPTION_FIELDS.map((f) =>
  f.key === "name-display" && f.kind === "select"
    ? {
        ...f,
        options: [
          ...f.options,
          { value: "team-over-driver", label: "Team over driver (endurance)", sims: ["iracing"] },
        ],
      }
    : f,
);

export const leaderboardManifest: OverlayManifest = {
  id: "leaderboard",
  title: "Leaderboard",
  description: "Standings for the whole field.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 569, height: 440 },
  minSize: { width: 300, height: 160 },
  defaultPosition: { x: 40, y: 40 },
  table: true,
  // Rows come from the settings, so they decide the height; the column fit sets the width. With
  // Show all the user sizes the window instead: its height picks how many rows show.
  fitContent: "height",
  fitContentOffWhen: { key: "show-all", value: true },
  fields: driverFields(DRIVER_FIELD_IDS, LEADERBOARD_DEFAULT_VISIBLE),
  settings: [
    ...LEADERBOARD_TABLE_FIELDS,
    {
      key: "irating-change",
      label: "iRating change",
      kind: "toggle",
      section: "Drivers",
      default: true,
      help: "Wide iRating pill with the projected change right-aligned.",
      sims: ["iracing"],
    },
    {
      key: "show-all",
      label: "Show all drivers",
      kind: "toggle",
      section: "Drivers around",
      default: false,
    },
    {
      key: "around",
      label: "Above / below me",
      kind: "number",
      section: "Drivers around",
      default: 3,
      min: 0,
      max: 20,
      step: 1,
    },
    {
      key: "top-my-class",
      label: "Top cars in my class",
      kind: "number",
      section: "Drivers around",
      default: 3,
      min: 0,
      max: 20,
      step: 1,
    },
    {
      key: "top-other-classes",
      label: "Top cars in other classes",
      help: "Per class.",
      kind: "number",
      section: "Drivers around",
      default: 2,
      min: 0,
      max: 10,
      step: 1,
    },
    {
      key: "session-header",
      label: "Session header",
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
      key: "show-dq-limit",
      label: "Show DQ limit",
      kind: "toggle",
      section: "Layout",
      default: true,
      sims: ["iracing"],
    },
    {
      key: "header-fields",
      label: "Header fields",
      kind: "multi",
      section: "Layout",
      default: ["current-lap", "session-remaining", "sof", "incidents", "track-temp"],
      options: HEADER_FIELD_OPTIONS,
      max: 8,
    },
  ],
  rateHz: 5,
  defaultEnabled: true,
};
