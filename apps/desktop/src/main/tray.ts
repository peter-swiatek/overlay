import { join } from "node:path";
import { Menu, Tray, app, dialog, nativeImage } from "electron";
import { BUILD_INFO } from "../shared/build-info";
import { MARKER_PRESETS } from "../shared/capture-types";
import type { CaptureManager } from "./capture-manager";
import type { OverlayManager } from "./overlays";
import type { TelemetryManager } from "./telemetry-manager";
import { buildAboutItem, buildDataSourceMenu, buildUpdateItems, trayTooltip } from "./tray-model";
import type { Updater } from "./updater";

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "tray.ico")
    : join(import.meta.dirname, "../../resources/tray.ico");
}

export interface TrayActions {
  showSettings(): void;
  quit(): void;
}

export class AppTray {
  private readonly tray: Tray;

  constructor(
    private readonly overlays: OverlayManager,
    private readonly capture: CaptureManager,
    private readonly telemetry: TelemetryManager,
    private readonly updater: Updater,
    private readonly actions: TrayActions,
  ) {
    this.tray = new Tray(nativeImage.createFromPath(trayIconPath()));
    this.tray.setToolTip(trayTooltip(BUILD_INFO));
    this.tray.on("double-click", () => actions.showSettings());
    this.refresh();
  }

  /** Rebuilds the menu so the checkboxes reflect current state. */
  refresh(): void {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Show settings", click: () => this.actions.showSettings() },
        {
          label: "Toggle overlays visible",
          type: "checkbox",
          checked: this.overlays.isVisible,
          click: () => this.overlays.toggleVisible(),
        },
        {
          label: "Toggle edit mode (Ctrl+Shift+F10)",
          type: "checkbox",
          checked: this.overlays.isEditMode,
          click: () => this.overlays.toggleEditMode(),
        },
        { type: "separator" },
        this.capture.isRecording
          ? { label: "Stop recording", click: () => this.capture.stop() }
          : { label: "Start recording", click: () => this.capture.start() },
        {
          label: "Mark moment",
          enabled: this.capture.isRecording,
          submenu: [
            { label: "Mark now", click: () => this.capture.mark("moment") },
            { type: "separator" },
            ...MARKER_PRESETS.map((label) => ({
              label,
              click: () => this.capture.mark(label),
            })),
          ],
        },
        { label: "Open fixtures folder", click: () => this.capture.openFolder() },
        { type: "separator" },
        {
          label: "Data source",
          submenu: buildDataSourceMenu(this.telemetry.getSettings(), {
            select: (source) => this.telemetry.updateSettings({ source }),
            pickReplayFile: () => void this.pickReplayFile(),
          }),
        },
        { type: "separator" },
        ...buildUpdateItems(
          {
            enabled: this.updater.enabled,
            state: this.updater.getState(),
            allowPrerelease: this.updater.allowPrerelease,
          },
          {
            checkNow: () => this.updater.checkNow(),
            setAllowPrerelease: (value) => this.updater.setAllowPrerelease(value),
            restartToUpdate: () => void this.updater.restartToUpdate(),
          },
        ),
        { type: "separator" },
        buildAboutItem(BUILD_INFO),
        { label: "Quit", click: () => this.actions.quit() },
      ]),
    );
  }

  private async pickReplayFile(): Promise<void> {
    const result = await dialog.showOpenDialog({
      title: "Replay a recording",
      properties: ["openFile"],
      filters: [{ name: "Fixture recording", extensions: ["ovfx"] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || path === undefined) {
      this.refresh(); // radio items flip on click even when nothing changed
      return;
    }
    this.telemetry.updateSettings({ source: "replay", replayPath: path });
  }

  destroy(): void {
    this.tray.destroy();
  }
}
