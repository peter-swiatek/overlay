import type { OverlayManifest } from "../contract";

export const incidentsManifest: OverlayManifest = {
  id: "incidents",
  title: "Incidents",
  description:
    "Your incident count against the session's penalty and disqualification limits, with a status pill and a progress bar.",
  sims: ["iracing"],
  defaultSize: { width: 120, height: 77 },
  minSize: { width: 96, height: 52 },
  defaultPosition: { x: 1640, y: 560 },
  table: false,
  fields: [],
  settings: [
    {
      key: "show-limits",
      label: "Penalty and DQ limits",
      kind: "toggle",
      section: "Layout",
      default: true,
      help: "Hidden for a limit the session does not set.",
    },
    {
      key: "show-bar",
      label: "Progress bar",
      kind: "toggle",
      section: "Layout",
      default: true,
      help: "Fills green up to the penalty limit, then red up to the DQ limit.",
    },
  ],
  rateHz: 5,
  defaultEnabled: false,
};
