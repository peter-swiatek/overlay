import { join } from "node:path";
import { Menu, Tray, app, nativeImage } from "electron";
import { MARKER_PRESETS } from "../shared/capture-types";
import type { CaptureManager } from "./capture-manager";
import type { OverlayManager } from "./overlays";

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
    private readonly actions: TrayActions,
  ) {
    this.tray = new Tray(nativeImage.createFromPath(trayIconPath()));
    this.tray.setToolTip("Overlay");
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
        { label: "Quit", click: () => this.actions.quit() },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}
