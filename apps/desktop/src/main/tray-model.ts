import type { BuildInfo } from "../shared/build-info";
import type { TelemetrySourceChoice } from "../shared/telemetry-types";
import type { TelemetrySettings } from "./telemetry-settings";
import type { UpdateState } from "./updater";

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

/** Tray tooltip, e.g. "Overlay 0.1.0". */
export function trayTooltip(build: Pick<BuildInfo, "displayVersion">): string {
  return `Overlay ${build.displayVersion}`;
}

/** Disabled "About" line at the bottom of the tray menu. */
export function buildAboutItem(build: Pick<BuildInfo, "displayVersion">): {
  label: string;
  enabled: false;
} {
  return { label: `Overlay ${build.displayVersion}`, enabled: false };
}

export interface UpdateMenuView {
  /** False for dev/local builds and unpackaged runs. */
  enabled: boolean;
  state: UpdateState;
  allowPrerelease: boolean;
}

export interface UpdateMenuActions {
  checkNow(): void;
  setAllowPrerelease(value: boolean): void;
  restartToUpdate(): void;
}

export interface UpdateMenuItem {
  label: string;
  enabled?: boolean;
  type?: "checkbox";
  checked?: boolean;
  click?: () => void;
}

/** Label of the "Check for updates" item for each state. */
export function updateCheckLabel(state: UpdateState): string {
  switch (state.kind) {
    case "checking":
      return "Checking...";
    case "available":
      return `Downloading v${state.version}...`;
    case "up-to-date":
      return "Up to date";
    case "error":
      return "Update check failed";
    case "downloaded":
      return `Update v${state.version} ready`;
    case "idle":
      return "Check for updates";
  }
}

/** Tray items for updates: check, "Include test builds", and restart once downloaded. */
export function buildUpdateItems(
  view: UpdateMenuView,
  actions: UpdateMenuActions,
): UpdateMenuItem[] {
  if (!view.enabled) return [{ label: "Updates: release builds only", enabled: false }];
  const { state } = view;
  const busy = state.kind !== "idle" && state.kind !== "up-to-date" && state.kind !== "error";
  const items: UpdateMenuItem[] = [
    { label: updateCheckLabel(state), enabled: !busy, click: () => actions.checkNow() },
    {
      label: "Include test builds",
      type: "checkbox",
      checked: view.allowPrerelease,
      click: () => actions.setAllowPrerelease(!view.allowPrerelease),
    },
  ];
  if (state.kind === "downloaded") {
    items.push({
      label: `Restart to update (v${state.version})`,
      click: () => actions.restartToUpdate(),
    });
  }
  return items;
}
