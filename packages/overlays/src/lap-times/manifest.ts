import type { OverlayManifest, SettingField } from "../contract";

const toggle = (key: string, label: string, section: string, help?: string): SettingField => ({
  key,
  label,
  kind: "toggle",
  section,
  default: true,
  ...(help === undefined ? {} : { help }),
});

export const lapTimesManifest: OverlayManifest = {
  id: "lap-times",
  title: "Lap Times",
  description:
    "Your recent laps with lap time, delta to your session best, track temperature and fuel used, and best / average / optimal times.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 360, height: 250 },
  minSize: { width: 220, height: 100 },
  defaultPosition: { x: 1360, y: 200 },
  table: false,
  fields: [],
  settings: [
    toggle(
      "show-top-bar",
      "Driver and stint",
      "Layout",
      "Top bar: car number, driver and stint laps.",
    ),
    toggle(
      "show-session-best",
      "Session best",
      "Layout",
      "Box above the laps with your best valid lap this session.",
    ),
    toggle("show-footer", "Averages and optimal", "Layout"),
    {
      key: "rows",
      label: "Laps listed",
      kind: "number",
      section: "Layout",
      default: 5,
      min: 1,
      max: 10,
      step: 1,
      unit: "laps",
    },
    toggle("col-lap", "Lap", "Columns"),
    toggle("col-lap-time", "Lap time", "Columns"),
    toggle(
      "col-delta",
      "Delta",
      "Columns",
      "This lap against your session best before it: green is a new best, red is time lost.",
    ),
    toggle("col-track", "Track temperature", "Columns", "Track temperature when the lap ended."),
    toggle(
      "col-fuel",
      "Fuel used",
      "Columns",
      "Your car only; empty for refuel laps and out-laps.",
    ),
    {
      key: "name-format",
      label: "Name format",
      kind: "select",
      section: "Layout",
      default: "f-last",
      options: [
        { value: "full", label: "Full name" },
        { value: "f-last", label: "F. Last" },
        { value: "first-l", label: "First L." },
        { value: "last", label: "Last only" },
        { value: "first", label: "First only" },
        { value: "last-f", label: "Last, F." },
      ],
    },
  ],
  rateHz: 5,
  defaultEnabled: false,
};
