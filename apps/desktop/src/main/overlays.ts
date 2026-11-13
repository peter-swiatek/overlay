import { BrowserWindow, screen } from "electron";
import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import {
  instanceNumber,
  instancesOf,
  manifestForInstance,
  parseInstanceId,
} from "@overlay/overlays/instances";
import type { SimName } from "@overlay/sim-core/types";
import type { TableMetrics } from "@overlay/ui/fit";
import { IPC, type Bounds, type Size } from "../shared/types";
import {
  fitTarget,
  parseTableMetrics,
  planAutoWidth,
  planOptionSize,
  retargetScale,
} from "./auto-width";
import {
  boundsNextTo,
  clampToWorkArea,
  defaultBounds,
  INSTANCE_GAP_PX,
  effectiveMinSize,
  growToMin,
  placeInWorkArea,
  initialBounds,
  isReachable,
  parseContentMin,
  planWindowChanges,
  resizeBounds,
  scaleBounds,
  scaleBoundsWithChrome,
  scaleContentMin,
  scaleSize,
  TITLE_BAR_PX,
  type Layout,
  type StoredBounds,
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
  /** Instance id (see @overlay/overlays/instances). */
  id: string;
  win: BrowserWindow;
  manifest: OverlayManifest;
  /** The scale the window is currently sized for. */
  scalePct: number;
  /** The smallest size the content reported it needs (window DIPs); zero until it reports. */
  contentMin: Size;
  /** The table font this window last reported (table overlays only). */
  metrics: TableMetrics | null;
  /** Window minimum width (DIPs at scalePct) from the never-hidden columns; 0 until known. */
  tableMinWidth: number;
}

function minArgs(size: Size): [number, number] {
  return [size.width, size.height];
}

/**
 * Owns the overlay windows: one per enabled overlay instance (an overlay can have several, each
 * keyed by its instance id), edit mode and layout persistence.
 */
export class OverlayManager {
  private readonly open = new Map<string, OpenOverlay>();
  private readonly layout: Layout;
  private editMode = false;
  private visible = true;
  /** In-memory enabled states that win over the stored settings (never saved); null when off. */
  private enabledOverride: Record<string, boolean> | null = null;
  private saveTimer: NodeJS.Timeout | undefined;
  /** The newest table font report from any window (all windows share the theme). */
  private lastMetrics: TableMetrics | null = null;
  /** The sim the telemetry source currently reads; null while unknown (replay, mock, none). */
  private activeSim: SimName | null = null;
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
    this.deps.overlaySettings.onRemove((id) => this.onInstanceRemoved(id));
    this.sync();
  }

  private manifestOf(id: string): OverlayManifest | undefined {
    return manifestForInstance(id, this.deps.manifests);
  }

  /** Every instance id with settings (instance 1 of every overlay plus the added ones). */
  private instanceIds(): string[] {
    return Object.keys(this.deps.overlaySettings.getAll());
  }

  /** An added instance was removed: closes its window and forgets its bounds. */
  private onInstanceRemoved(id: string): void {
    const entry = this.open.get(id);
    if (entry) {
      this.open.delete(id);
      if (!entry.win.isDestroyed()) entry.win.close();
      this.deps.onStateChange();
    }
    delete this.layout[id];
    this.flushSave();
  }

  /**
   * Bounds of the window a new instance is placed next to: the nearest lower-numbered instance
   * of the same overlay that has bounds, else the highest-numbered one. Undefined for instance 1.
   */
  private anchorFor(id: string): Bounds | undefined {
    const ref = parseInstanceId(id);
    if (ref === null || ref.n < 2) return undefined;
    const placed = instancesOf(ref.overlayId, Object.keys(this.layout)).filter((o) => o !== id);
    const pick = placed.filter((o) => instanceNumber(o) < ref.n).at(-1) ?? placed.at(-1);
    if (pick === undefined) return undefined;
    const live = this.open.get(pick)?.win;
    if (live && !live.isDestroyed()) return live.getBounds();
    const stored = this.layout[pick];
    return stored && { x: stored.x, y: stored.y, width: stored.width, height: stored.height };
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
      const manifest = this.manifestOf(id);
      const instance = settings[id];
      if (manifest && instance) this.create(id, manifest, instance);
    }
  }

  private onSettingsChange(id: string, settings: OverlayInstanceSettings): void {
    const manifest = this.manifestOf(id);
    if (!manifest) return;
    const current = this.open.get(id);
    if (manifest.dev === true && !this.developerEnabled()) return;
    const enabled = this.enabledOverride?.[id] ?? settings.enabled;
    if (enabled && !current) {
      this.create(id, manifest, settings);
    } else if (!enabled && current) {
      this.close(id);
    } else if (current && current.scalePct !== settings.common.scalePct) {
      this.rescale(current, settings);
    }
    if (this.open.has(id) || this.layout[id]) {
      this.applyFit(id);
      this.applyOptionSize(id);
    }
  }

  /** Writes new bounds for an overlay, keeping its recorded fit width and option size. */
  private store(id: string, bounds: Bounds, scalePct: number): void {
    const prev = this.layout[id];
    const next: StoredBounds = { ...bounds, scalePct };
    if (prev?.fitWidth !== undefined) next.fitWidth = prev.fitWidth;
    if (prev?.sizedFor !== undefined) next.sizedFor = prev.sizedFor;
    this.layout[id] = next;
  }

  private metricsFor(id: string): TableMetrics | null {
    return this.open.get(id)?.metrics ?? this.lastMetrics;
  }

  private chromeFor(id: string): number {
    return this.effectiveSettings()[id]?.common.showTitleBar ? TITLE_BAR_PX : 0;
  }

  /**
   * Follows the column fit: when the fit width changed since it was last applied, sets the window
   * (or the stored bounds of a closed overlay) to it. Also raises the window minimum.
   */
  private applyFit(id: string): void {
    const manifest = this.manifestOf(id);
    const settings = this.effectiveSettings()[id];
    const metrics = this.metricsFor(id);
    if (!manifest?.table || !settings || !metrics) return;
    const target = fitTarget(manifest, settings, metrics, this.activeSim);
    const entry = this.open.get(id);
    const prevFit = this.layout[id]?.fitWidth;
    if (entry && !entry.win.isDestroyed()) {
      entry.tableMinWidth = target.minWidth;
      const min = effectiveMinSize(
        manifest.minSize,
        entry.scalePct,
        entry.contentMin,
        target.minWidth,
      );
      entry.win.setMinimumSize(...minArgs(min));
      const bounds = entry.win.getBounds();
      const plan = planAutoWidth({
        bounds,
        storedFitWidth: prevFit,
        target,
        area: screen.getDisplayMatching(bounds).workArea,
      });
      if (plan.bounds) entry.win.setBounds(plan.bounds);
      this.store(id, plan.bounds ?? bounds, entry.scalePct);
      const stored = this.layout[id];
      if (stored && plan.fitWidth !== undefined) stored.fitWidth = plan.fitWidth;
      if (plan.bounds || plan.fitWidth !== prevFit) this.scheduleSave();
      return;
    }
    const stored = this.layout[id];
    if (!stored) return;
    // The stored bounds stay at their own scale until the overlay opens, so the target does too.
    const storedTarget = retargetScale(target, settings.common.scalePct, stored.scalePct);
    const plan = planAutoWidth({
      bounds: stored,
      storedFitWidth: prevFit,
      target: storedTarget,
      area: screen.getDisplayMatching(stored).workArea,
    });
    if (plan.bounds || plan.fitWidth !== prevFit) {
      const next: StoredBounds = { ...stored, ...(plan.bounds ?? {}) };
      if (plan.fitWidth !== undefined) next.fitWidth = plan.fitWidth;
      this.layout[id] = next;
      this.scheduleSave();
    }
  }

  /** Resizes a sizeByOption overlay (Fuel Calculator) when its layout option changed. */
  private applyOptionSize(id: string): void {
    const manifest = this.manifestOf(id);
    const settings = this.effectiveSettings()[id];
    if (!manifest?.sizeByOption || !settings) return;
    const entry = this.open.get(id);
    const stored = this.layout[id];
    const live = entry && !entry.win.isDestroyed() ? entry.win : undefined;
    const bounds = live?.getBounds() ?? stored;
    if (!bounds) return;
    const plan = planOptionSize({
      manifest,
      settings,
      sizedFor: stored?.sizedFor,
      bounds,
      area: screen.getDisplayMatching(bounds).workArea,
      chromePx: this.chromeFor(id),
    });
    if (plan.bounds) {
      live?.setBounds(plan.bounds);
      this.store(id, plan.bounds, entry?.scalePct ?? settings.common.scalePct);
    }
    const now = this.layout[id];
    if (now && now.sizedFor !== plan.sizedFor) {
      if (plan.sizedFor === undefined) delete now.sizedFor;
      else now.sizedFor = plan.sizedFor;
      this.scheduleSave();
    } else if (plan.bounds) {
      this.scheduleSave();
    }
  }

  /** Sets the sim the telemetry source reads (null when unknown) and refits the table overlays when it changed. */
  setActiveSim(sim: SimName | null): void {
    if (sim === this.activeSim) return;
    this.activeSim = sim;
    for (const id of this.instanceIds()) {
      if (this.manifestOf(id)?.table) this.applyFit(id);
    }
  }

  /** Handles an overlay window's table font report: refits it and any closed table overlay. */
  setTableMetricsFromSender(sender: Electron.WebContents, payload: unknown): void {
    const metrics = parseTableMetrics(payload);
    const id = this.idOfSender(sender);
    const entry = id === undefined ? undefined : this.open.get(id);
    if (!metrics || id === undefined || !entry) return;
    const prev = this.lastMetrics;
    entry.metrics = metrics;
    this.lastMetrics = metrics;
    this.applyFit(id);
    if (prev?.chPx === metrics.chPx && prev.cellPadPx === metrics.cellPadPx) return;
    for (const other of this.instanceIds()) {
      if (this.manifestOf(other)?.table && other !== id && !this.open.has(other)) {
        this.applyFit(other);
      }
    }
  }

  private create(id: string, manifest: OverlayManifest, settings: OverlayInstanceSettings): void {
    const scalePct = settings.common.scalePct;
    const workAreas = screen.getAllDisplays().map((d) => d.workArea);
    const primary = screen.getPrimaryDisplay().workArea;
    const n = instanceNumber(id);
    if (!this.layout[id] && n >= 2) {
      // First use of an added instance: next to another instance of the same overlay, or the
      // default position moved down and right by its number when none has been placed.
      const min = scaleSize(manifest.minSize, scalePct);
      const anchor = this.anchorFor(id);
      const step = INSTANCE_GAP_PX * 3 * (n - 1);
      const fallback = defaultBounds(manifest, scalePct, primary);
      const area = screen.getDisplayMatching(anchor ?? fallback).workArea;
      const bounds = anchor
        ? boundsNextTo(anchor, area, min)
        : placeInWorkArea({ ...fallback, x: fallback.x + step, y: fallback.y + step }, area, min);
      this.layout[id] = { ...bounds, scalePct };
    }
    const stored = this.layout[id];
    // A scale change made while the overlay was off applies now.
    const sized =
      stored && stored.scalePct !== scalePct
        ? {
            ...stored,
            ...scaleBounds(stored, stored.scalePct, scalePct, manifest.minSize),
          }
        : stored;
    let bounds = initialBounds(manifest, sized, scalePct, workAreas, primary);
    const spec = manifest.sizeByOption;
    const optionValue = spec ? settings.options[spec.key] : undefined;
    const optionSize =
      spec && typeof optionValue === "string" ? spec.sizes[optionValue] : undefined;
    if (optionSize && !stored) {
      // First use: open at the size of the layout option's current value.
      const scaled = scaleSize(optionSize, scalePct);
      const chrome = settings.common.showTitleBar ? TITLE_BAR_PX : 0;
      bounds = placeInWorkArea(
        { ...bounds, width: scaled.width, height: scaled.height + chrome },
        workAreas.find((a) => isReachable(bounds, [a])) ?? primary,
        scaleSize(manifest.minSize, scalePct),
      );
    }
    const layoutEntry: StoredBounds = { ...bounds, scalePct };
    if (sized?.fitWidth !== undefined) layoutEntry.fitWidth = sized.fitWidth;
    if (sized?.sizedFor !== undefined) layoutEntry.sizedFor = sized.sizedFor;
    else if (optionSize && !stored && typeof optionValue === "string") {
      layoutEntry.sizedFor = optionValue;
    }
    if (stored && stored.scalePct !== scalePct && layoutEntry.fitWidth !== undefined) {
      // The fit was recorded at the old scale; re-record it at this one (no resize).
      const target = this.lastMetrics
        ? fitTarget(manifest, settings, this.lastMetrics, this.activeSim)
        : null;
      if (target?.fitWidth != null) layoutEntry.fitWidth = target.fitWidth;
    }
    this.layout[id] = layoutEntry;

    const win = new BrowserWindow(buildOverlayWindowOptions({ bounds, preloadPath }));
    this.open.set(id, {
      id,
      win,
      manifest,
      scalePct,
      contentMin: { width: 0, height: 0 },
      metrics: null,
      tableMinWidth: 0,
    });
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
      this.store(id, win.getBounds(), this.open.get(id)?.scalePct ?? scalePct);
      this.scheduleSave();
    };
    win.on("moved", remember);
    win.on("resized", remember);
    win.on("closed", () => {
      // A newer window for the same id may already have replaced this one.
      if (this.open.get(id)?.win === win) this.open.delete(id);
    });

    this.applyFit(id);
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
      this.store(id, entry.win.getBounds(), entry.scalePct);
      entry.win.close();
    }
    this.flushSave();
    this.deps.onStateChange();
  }

  private rescale(entry: OpenOverlay, settings: OverlayInstanceSettings): void {
    const toPct = settings.common.scalePct;
    const { win, manifest, id } = entry;
    if (win.isDestroyed()) return;
    const current = win.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    // The title bar, when shown in flow, is fixed px: only the content under it scales.
    const chrome = this.deps.overlaySettings.get(id)?.common.showTitleBar ? TITLE_BAR_PX : 0;
    // The reported content minimum was measured at the old scale; it is re-measured shortly.
    entry.contentMin = scaleContentMin(entry.contentMin, (toPct / entry.scalePct) * 100, chrome);
    const metrics = this.metricsFor(id);
    const target = metrics ? fitTarget(manifest, settings, metrics, this.activeSim) : null;
    entry.tableMinWidth = target
      ? target.minWidth
      : Math.round((entry.tableMinWidth * toPct) / entry.scalePct);
    const min = effectiveMinSize(manifest.minSize, toPct, entry.contentMin, entry.tableMinWidth);
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
    this.store(id, next, toPct);
    // Record the fit at the new scale so a later unrelated change does not refit.
    const stored = this.layout[id];
    if (stored && target?.fitWidth != null) stored.fitWidth = target.fitWidth;
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
    const min = effectiveMinSize(
      entry.manifest.minSize,
      entry.scalePct,
      entry.contentMin,
      entry.tableMinWidth,
    );
    const current = entry.win.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const next = clampToWorkArea(resizeBounds(current, dx, dy, min), area, min);
    entry.win.setBounds(next);
    this.store(id, next, entry.scalePct);
    this.scheduleSave();
  }

  /** Handles the content's reported minimum size: raises the window minimum and grows the window. */
  setContentMinFromSender(sender: Electron.WebContents, payload: unknown): void {
    const reported = parseContentMin(payload);
    const id = this.idOfSender(sender);
    const entry = id === undefined ? undefined : this.open.get(id);
    if (!reported || id === undefined || !entry || entry.win.isDestroyed()) return;
    entry.contentMin = reported;
    const min = effectiveMinSize(
      entry.manifest.minSize,
      entry.scalePct,
      reported,
      entry.tableMinWidth,
    );
    entry.win.setMinimumSize(...minArgs(min));
    const current = entry.win.getBounds();
    if (current.width >= min.width && current.height >= min.height) return;
    const area = screen.getDisplayMatching(current).workArea;
    const next = growToMin(current, min, area);
    entry.win.setBounds(next);
    this.store(id, next, entry.scalePct);
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
