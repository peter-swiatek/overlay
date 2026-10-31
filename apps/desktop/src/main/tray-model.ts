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

type FixedSource = Exclude<TelemetrySourceChoice, "replay">;

const ALWAYS: { source: FixedSource; label: string }[] = [
  { source: "auto", label: "Auto" },
  { source: "iracing", label: "iRacing" },
  { source: "lmu", label: "LMU" },
];

/**
 * The "Data source" submenu. Mock and Replay file are test sources: they show only with developer
 * tools on, or while one of them is the current source (so the checked item is never hidden).
 */
export function buildDataSourceMenu(
  settings: TelemetrySettings,
  actions: DataSourceActions,
  developerEnabled = false,
): RadioItem[] {
  const item = (label: string, checked: boolean, click: () => void): RadioItem => ({
    label,
    type: "radio",
    checked,
    click,
  });
  const items = ALWAYS.map((entry) =>
    item(entry.label, settings.source === entry.source, () => actions.select(entry.source)),
  );
  if (developerEnabled || settings.source === "mock") {
    items.push(item("Mock", settings.source === "mock", () => actions.select("mock")));
  }
  if (developerEnabled || settings.source === "replay") {
    items.push(
      item("Replay file...", settings.source === "replay", () => actions.pickReplayFile()),
    );
  }
  return items;
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
  /** False for local builds and unpackaged runs. */
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
  if (!view.enabled) return [{ label: "Updates: not available in local builds", enabled: false }];
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
