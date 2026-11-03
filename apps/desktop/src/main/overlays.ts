import { BrowserWindow, screen } from "electron";
import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { IPC, type Size } from "../shared/types";
import {
  clampToWorkArea,
  effectiveMinSize,
  growToMin,
  initialBounds,
  parseContentMin,
  planWindowChanges,
  resizeBounds,
  scaleBounds,
  scaleBoundsWithChrome,
  scaleContentMin,
  scaleSize,
  TITLE_BAR_PX,
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
  /** Whether developer tools are on; developer-only overlays stay closed while they are off. */
  isDeveloperEnabled?: () => boolean;
  /** Called after each (debounced) layout save, so sizes can be pushed to the main window. */
  onLayoutSaved?: () => void;
}

interface OpenOverlay {
  win: BrowserWindow;
  manifest: OverlayManifest;
  /** The scale the window is currently sized for. */
  scalePct: number;
  /** The smallest size the content reported it needs (window DIPs); zero until it reports. */
  contentMin: Size;
}

function minArgs(size: Size): [number, number] {
  return [size.width, size.height];
}

/** Owns the overlay windows: one per enabled overlay, edit mode and layout persistence. */
export class OverlayManager {
  private readonly open = new Map<string, OpenOverlay>();
  private readonly layout: Layout;
  private editMode = false;
  private visible = true;
  /** In-memory enabled states that win over the stored settings (never saved); null when off. */
  private enabledOverride: Record<string, boolean> | null = null;
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

  /** A copy of the current layout (bounds and scale of every overlay placed so far). */
  getLayout(): Layout {
    return structuredClone(this.layout);
  }

  start(): void {
    this.deps.overlaySettings.onChange((id, settings) => this.onSettingsChange(id, settings));
    this.sync();
  }

  /** Call when the developer-tools switch changes: opens or closes the developer-only overlays. */
  refreshDeveloperMode(): void {
    this.sync();
  }

  private developerEnabled(): boolean {
    return this.deps.isDeveloperEnabled?.() ?? true;
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

  /**
   * Temporarily opens or closes overlays regardless of their stored enabled state (the CPU check
   * uses it). Ids missing from `override` keep their stored state; null restores everything.
   * Nothing is written to the overlay settings.
   */
  setEnabledOverride(override: Record<string, boolean> | null): void {
    this.enabledOverride = override;
    this.sync();
  }

  private effectiveSettings(): Record<string, OverlayInstanceSettings> {
    const all = this.deps.overlaySettings.getAll();
    const override = this.enabledOverride;
    if (override === null) return all;
    return Object.fromEntries(
      Object.entries(all).map(([id, s]) => [id, { ...s, enabled: override[id] ?? s.enabled }]),
    );
  }

  /** Opens and closes windows so they match the enabled overlays. */
  private sync(): void {
    const settings = this.effectiveSettings();
    const plan = planWindowChanges(
      this.deps.manifests,
      settings,
      this.open.keys(),
      this.developerEnabled(),
    );
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
    if (manifest.dev === true && !this.developerEnabled()) return;
    const enabled = this.enabledOverride?.[id] ?? settings.enabled;
    if (enabled && !current) {
      this.create(manifest, settings);
    } else if (!enabled && current) {
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
    const stored = this.layout[id];
    // A scale change made while the overlay was off applies now.
    const sized =
      stored && stored.scalePct !== scalePct
        ? {
            ...stored,
            ...scaleBounds(stored, stored.scalePct, scalePct, manifest.minSize),
          }
        : stored;
    const bounds = initialBounds(manifest, sized, scalePct, workAreas, primary);
    this.layout[id] = { ...bounds, scalePct };

    const win = new BrowserWindow(buildOverlayWindowOptions({ bounds, preloadPath }));
    this.open.set(id, { win, manifest, scalePct, contentMin: { width: 0, height: 0 } });
    win.setMinimumSize(...minArgs(scaleSize(manifest.minSize, scalePct)));
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true);
    // On Windows any setOpacity call makes the window layered, so only call it for the workaround.
    if (this.deps.opacityWorkaround) win.setOpacity(OPACITY_WORKAROUND_VALUE);
    // Racing: click-through. Editing: clickable so the frame and grip receive input.
    if (this.editMode) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });

    const remember = (): void => {
      if (win.isDestroyed()) return;
      this.layout[id] = { ...win.getBounds(), scalePct: this.open.get(id)?.scalePct ?? scalePct };
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
      this.layout[id] = { ...entry.win.getBounds(), scalePct: entry.scalePct };
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
    // The title bar, when shown in flow, is fixed px: only the content under it scales.
    const chrome = this.deps.overlaySettings.getAll()[manifest.id]?.common.showTitleBar
      ? TITLE_BAR_PX
      : 0;
    // The reported content minimum was measured at the old scale; it is re-measured shortly.
    entry.contentMin = scaleContentMin(entry.contentMin, (toPct / entry.scalePct) * 100, chrome);
    const min = effectiveMinSize(manifest.minSize, toPct, entry.contentMin);
    const next = clampToWorkArea(
      growToMin(
        scaleBoundsWithChrome(current, entry.scalePct, toPct, manifest.minSize, chrome),
        min,
        area,
      ),
      area,
      min,
    );
    entry.scalePct = toPct;
    win.setMinimumSize(...minArgs(min));
    win.setBounds(next);
    this.layout[manifest.id] = { ...next, scalePct: toPct };
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
    const min = effectiveMinSize(entry.manifest.minSize, entry.scalePct, entry.contentMin);
    const current = entry.win.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const next = clampToWorkArea(resizeBounds(current, dx, dy, min), area, min);
    entry.win.setBounds(next);
    this.layout[id] = { ...next, scalePct: entry.scalePct };
    this.scheduleSave();
  }

  /** Handles the content's reported minimum size: raises the window minimum and grows the window. */
  setContentMinFromSender(sender: Electron.WebContents, payload: unknown): void {
    const reported = parseContentMin(payload);
    const id = this.idOfSender(sender);
    const entry = id === undefined ? undefined : this.open.get(id);
    if (!reported || id === undefined || !entry || entry.win.isDestroyed()) return;
    entry.contentMin = reported;
    const min = effectiveMinSize(entry.manifest.minSize, entry.scalePct, reported);
    entry.win.setMinimumSize(...minArgs(min));
    const current = entry.win.getBounds();
    if (current.width >= min.width && current.height >= min.height) return;
    const area = screen.getDisplayMatching(current).workArea;
    const next = growToMin(current, min, area);
    entry.win.setBounds(next);
    this.layout[id] = { ...next, scalePct: entry.scalePct };
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
    this.deps.onLayoutSaved?.();
  }
}
