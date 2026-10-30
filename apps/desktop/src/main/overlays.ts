import { BrowserWindow, screen } from "electron";
import { IPC, type Bounds, type OverlayId } from "../shared/types";
import { OVERLAY_DEFINITIONS, isReachable, resizeBounds, type Layout } from "./layout";
import type { LayoutStore } from "./layout-store";
import { loadPage, preloadPath } from "./pages";
import { buildOverlayWindowOptions, overlayOpacity } from "./window-options";

const SAVE_DEBOUNCE_MS = 300;

/** Owns the overlay windows: creation, visibility, edit mode and layout persistence. */
export class OverlayManager {
  private readonly windows = new Map<OverlayId, BrowserWindow>();
  private layout: Layout;
  private editMode = false;
  private visible = true;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: LayoutStore,
    private readonly opacityWorkaround: boolean,
    private readonly onStateChange: () => void,
  ) {
    this.layout = store.load();
  }

  get isEditMode(): boolean {
    return this.editMode;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  start(): void {
    const workAreas = screen.getAllDisplays().map((d) => d.workArea);
    for (const def of OVERLAY_DEFINITIONS) {
      let bounds = this.layout[def.id];
      if (!isReachable(bounds, workAreas)) {
        bounds = { ...def.defaultBounds };
        this.layout[def.id] = bounds;
      }
      this.create(def.id, bounds);
    }
  }

  private create(id: OverlayId, bounds: Bounds): void {
    const win = new BrowserWindow(buildOverlayWindowOptions({ bounds, preloadPath }));
    this.windows.set(id, win);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true);
    win.setOpacity(overlayOpacity(this.opacityWorkaround));
    win.setIgnoreMouseEvents(true, { forward: true });

    const remember = (): void => {
      if (win.isDestroyed()) return;
      this.layout[id] = win.getBounds();
      this.scheduleSave();
    };
    win.on("moved", remember);
    win.on("resized", remember);
    win.on("closed", () => this.windows.delete(id));

    void loadPage(win, "overlay", { id });
    win.once("ready-to-show", () => {
      if (this.visible) win.showInactive();
    });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const win of this.windows.values()) {
      if (visible) win.showInactive();
      else win.hide();
    }
    this.onStateChange();
  }

  toggleVisible(): void {
    this.setVisible(!this.visible);
  }

  setEditMode(editing: boolean): void {
    this.editMode = editing;
    for (const win of this.windows.values()) {
      // Racing: click-through. Editing: clickable so the frame and grip receive input.
      if (editing) win.setIgnoreMouseEvents(false);
      else win.setIgnoreMouseEvents(true, { forward: true });
      win.webContents.send(IPC.editModeChanged, editing);
      if (!editing) win.blur();
    }
    if (!editing) this.flushSave();
    this.onStateChange();
  }

  toggleEditMode(): void {
    this.setEditMode(!this.editMode);
  }

  /** Handles a grip drag: grows or shrinks the window that sent the request. */
  resizeFromSender(sender: Electron.WebContents, dx: number, dy: number): void {
    if (!this.editMode) return;
    for (const def of OVERLAY_DEFINITIONS) {
      const win = this.windows.get(def.id);
      if (win && !win.isDestroyed() && win.webContents === sender) {
        const next = resizeBounds(win.getBounds(), dx, dy, def.minSize);
        win.setBounds(next);
        this.layout[def.id] = next;
        this.scheduleSave();
      }
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  flushSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    try {
      this.store.save(this.layout);
    } catch (error) {
      console.error("Could not save overlay layout", error);
    }
  }
}
