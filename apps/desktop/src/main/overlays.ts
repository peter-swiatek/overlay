import { BrowserWindow, screen } from "electron";
import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { IPC } from "../shared/types";
import {
  clampToWorkArea,
  initialBounds,
  planWindowChanges,
  resizeBounds,
  scaleBounds,
  scaleSize,
  type Layout,
} from "./layout";
import type { LayoutStore } from "./layout-store";
import type { OverlaySettingsStore } from "./overlay-settings-store";
import { loadPage, preloadPath } from "./pages";
import { OPACITY_WORKAROUND_VALUE, buildOverlayWindowOptions } from "./window-options";

const SAVE_DEBOUNCE_MS = 300;

export interface OverlayManagerDeps {
  layoutStore: LayoutStore;
  overlaySettings: OverlaySettingsStore;
  manifests: readonly OverlayManifest[];
  opacityWorkaround: boolean;
  onStateChange: () => void;
}

interface OpenOverlay {
  win: BrowserWindow;
  manifest: OverlayManifest;
  /** The scale the window is currently sized for. */
  scalePct: number;
}

/** Owns the overlay windows: one per enabled overlay, edit mode and layout persistence. */
export class OverlayManager {
  private readonly open = new Map<string, OpenOverlay>();
  private readonly layout: Layout;
  private editMode = false;
  private visible = true;
  private saveTimer: NodeJS.Timeout | undefined;
  /** Asks the z-order keeper to re-raise the overlays (never activates them). */
  onShouldRaise: (() => void) | undefined;

  constructor(private readonly deps: OverlayManagerDeps) {
    this.layout = deps.layoutStore.load(deps.manifests);
  }

  get isEditMode(): boolean {
    return this.editMode;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  start(): void {
    this.deps.overlaySettings.onChange((id, settings) => this.onSettingsChange(id, settings));
    this.sync();
  }

  /** The overlay windows, for the z-order keeper. */
  getWindows(): BrowserWindow[] {
    return [...this.open.values()].map((o) => o.win);
  }

  /** The overlay id of the window that owns `sender`, if any. */
  idOfSender(sender: Electron.WebContents): string | undefined {
    for (const [id, o] of this.open) {
      if (!o.win.isDestroyed() && o.win.webContents === sender) return id;
    }
    return undefined;
  }

  /** Opens and closes windows so they match the enabled overlays. */
  private sync(): void {
    const settings = this.deps.overlaySettings.getAll();
    const plan = planWindowChanges(this.deps.manifests, settings, this.open.keys());
    for (const id of plan.close) this.close(id);
    for (const id of plan.open) {
      const manifest = this.deps.manifests.find((m) => m.id === id);
      const instance = settings[id];
      if (manifest && instance) this.create(manifest, instance);
    }
  }

  private onSettingsChange(id: string, settings: OverlayInstanceSettings): void {
    const manifest = this.deps.manifests.find((m) => m.id === id);
    if (!manifest) return;
    const current = this.open.get(id);
    if (settings.enabled && !current) {
      this.create(manifest, settings);
    } else if (!settings.enabled && current) {
      this.close(id);
    } else if (current && current.scalePct !== settings.common.scalePct) {
      this.rescale(current, settings.common.scalePct);
    }
  }

  private create(manifest: OverlayManifest, settings: OverlayInstanceSettings): void {
    const id = manifest.id;
    const scalePct = settings.common.scalePct;
    const workAreas = screen.getAllDisplays().map((d) => d.workArea);
    const primary = screen.getPrimaryDisplay().workArea;
    const bounds = initialBounds(manifest, this.layout[id], scalePct, workAreas, primary);
    this.layout[id] = bounds;

    const win = new BrowserWindow(buildOverlayWindowOptions({ bounds, preloadPath }));
    this.open.set(id, { win, manifest, scalePct });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true);
    // On Windows any setOpacity call makes the window layered, so only call it for the workaround.
    if (this.deps.opacityWorkaround) win.setOpacity(OPACITY_WORKAROUND_VALUE);
    // Racing: click-through. Editing: clickable so the frame and grip receive input.
    if (this.editMode) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });

    const remember = (): void => {
      if (win.isDestroyed()) return;
      this.layout[id] = win.getBounds();
      this.scheduleSave();
    };
    win.on("moved", remember);
    win.on("resized", remember);
    win.on("closed", () => {
      // A newer window for the same id may already have replaced this one.
      if (this.open.get(id)?.win === win) this.open.delete(id);
    });

    void loadPage(win, "overlay", { id });
    win.once("ready-to-show", () => {
      if (this.visible) {
        win.showInactive();
        this.onShouldRaise?.();
      }
    });
    this.deps.onStateChange();
  }

  private close(id: string): void {
    const entry = this.open.get(id);
    if (!entry) return;
    this.open.delete(id);
    if (!entry.win.isDestroyed()) {
      this.layout[id] = entry.win.getBounds();
      entry.win.close();
    }
    this.flushSave();
    this.deps.onStateChange();
  }

  private rescale(entry: OpenOverlay, toPct: number): void {
    const { win, manifest } = entry;
    if (win.isDestroyed()) return;
    const current = win.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const min = scaleSize(manifest.minSize, toPct);
    const next = clampToWorkArea(
      scaleBounds(current, entry.scalePct, toPct, manifest.minSize),
      area,
      min,
    );
    entry.scalePct = toPct;
    win.setBounds(next);
    this.layout[manifest.id] = next;
    this.scheduleSave();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const { win } of this.open.values()) {
      if (visible) win.showInactive();
      else win.hide();
    }
    if (visible) this.onShouldRaise?.();
    this.deps.onStateChange();
  }

  toggleVisible(): void {
    this.setVisible(!this.visible);
  }

  setEditMode(editing: boolean): void {
    this.editMode = editing;
    for (const { win } of this.open.values()) {
      if (editing) win.setIgnoreMouseEvents(false);
      else win.setIgnoreMouseEvents(true, { forward: true });
      win.webContents.send(IPC.editModeChanged, editing);
      if (!editing) win.blur();
    }
    if (!editing) {
      this.flushSave();
      this.onShouldRaise?.();
    }
    this.deps.onStateChange();
  }

  toggleEditMode(): void {
    this.setEditMode(!this.editMode);
  }

  /** True when the sender is one of the overlay windows. */
  isOverlaySender(sender: Electron.WebContents): boolean {
    return this.idOfSender(sender) !== undefined;
  }

  /** Handles a grip drag: grows or shrinks the window that sent the request. */
  resizeFromSender(sender: Electron.WebContents, dx: number, dy: number): void {
    if (!this.editMode) return;
    const id = this.idOfSender(sender);
    const entry = id === undefined ? undefined : this.open.get(id);
    if (id === undefined || !entry || entry.win.isDestroyed()) return;
    const min = scaleSize(entry.manifest.minSize, entry.scalePct);
    const current = entry.win.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const next = clampToWorkArea(resizeBounds(current, dx, dy, min), area, min);
    entry.win.setBounds(next);
    this.layout[id] = next;
    this.scheduleSave();
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  flushSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    try {
      this.deps.layoutStore.save(this.layout);
    } catch (error) {
      console.error("Could not save overlay layout", error);
    }
  }
}
