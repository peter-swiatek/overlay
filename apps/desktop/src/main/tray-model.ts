import type { TelemetrySourceChoice } from "../shared/telemetry-types";
import type { TelemetrySettings } from "./telemetry-settings";

export interface DataSourceActions {
  select(source: Exclude<TelemetrySourceChoice, "replay">): void;
  /** Opens the file dialog; the replay source is chosen once a file is picked. */
  pickReplayFile(): void;
}

export interface RadioItem {
  label: string;
  type: "radio";
  checked: boolean;
  click: () => void;
}

const FIXED: { source: Exclude<TelemetrySourceChoice, "replay">; label: string }[] = [
  { source: "auto", label: "Auto" },
  { source: "iracing", label: "iRacing" },
  { source: "lmu", label: "LMU" },
  { source: "mock", label: "Mock" },
];

/** The "Data source" submenu: Auto, iRacing, LMU, Replay file..., Mock. */
export function buildDataSourceMenu(
  settings: TelemetrySettings,
  actions: DataSourceActions,
): RadioItem[] {
  const item = (label: string, checked: boolean, click: () => void): RadioItem => ({
    label,
    type: "radio",
    checked,
    click,
  });
  const fixed = (entry: (typeof FIXED)[number]): RadioItem =>
    item(entry.label, settings.source === entry.source, () => actions.select(entry.source));
  const [auto, iracing, lmu, mock] = FIXED.map(fixed) as [
    RadioItem,
    RadioItem,
    RadioItem,
    RadioItem,
  ];
  return [
    auto,
    iracing,
    lmu,
    item("Replay file...", settings.source === "replay", () => actions.pickReplayFile()),
    mock,
  ];
}
