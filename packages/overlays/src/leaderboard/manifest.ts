import type { OverlayManifest } from "../contract";
// Pure files only: the desktop main process type-checks manifests without JSX.
import { DRIVER_FIELDS } from "../shared/fields";
import { HEADER_FIELD_OPTIONS } from "../shared/info";
import { TABLE_OPTION_FIELDS } from "../shared/options";

// Left out of M2 (orchestrator decision; plan question 2 is unanswered): country flag,
// manufacturer, iRating change, push to pass, tyre compound, per-car flags, highlight incidents.
export const leaderboardManifest: OverlayManifest = {
  id: "leaderboard",
  title: "Leaderboard",
  description: "Standings for the whole field.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 560, height: 440 },
  minSize: { width: 300, height: 160 },
  defaultPosition: { x: 40, y: 40 },
  table: true,
  fields: DRIVER_FIELDS,
  settings: [
    ...TABLE_OPTION_FIELDS,
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
      default: ["session-remaining", "sof", "incidents", "track-temp"],
      options: HEADER_FIELD_OPTIONS,
      max: 6,
    },
  ],
  rateHz: 5,
  defaultEnabled: true,
};
