import { join } from "node:path";
import { Menu, Tray, app, nativeImage } from "electron";
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
        { label: "Quit", click: () => this.actions.quit() },
      ]),
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}
