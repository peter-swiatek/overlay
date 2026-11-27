import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import {
  DEFAULT_LAYOUT_ID,
  EMPTY_SIM_CONTEXT,
  type LayoutsState,
  type SimContext,
} from "../shared/layout-types";
import type { Layout } from "./layout";
import { ContextChangeTracker, pickLayout } from "./layout-match";
import type { LayoutsStore } from "./layouts-store";

/** The parts of the overlay manager a switch drives. */
export interface SwitchableOverlays {
  /** Writes pending bounds into the (still) active layout now. */
  flushSave(): void;
  /** Moves the open windows to the new layout's bounds; later saves go to it. */
  replaceLayout(bounds: Layout): void;
}

/** The parts of the overlay settings store a switch uses. */
export interface SwitchableSettings {
  getAll(): Record<string, OverlayInstanceSettings>;
  update(id: string, patch: unknown): OverlayInstanceSettings | undefined;
  onChange(listener: (id: string, settings: OverlayInstanceSettings) => void): () => void;
  onRemove(listener: (id: string) => void): () => void;
}

export interface LayoutSwitcherDeps {
  store: LayoutsStore;
  overlays: SwitchableOverlays;
  settings: SwitchableSettings;
  /** Called after anything the Layouts page shows changed. */
  onStateChange?: (state: LayoutsState) => void;
}

/**
 * Applies layouts: switching flushes the old layout's bounds, moves the windows to the new
 * layout's bounds and turns instances on or off to match it. Turning an instance on or off
 * (anywhere in the app) is saved into the active layout. Also runs the automatic switch.
 */
export class LayoutSwitcher {
  private context: SimContext = EMPTY_SIM_CONTEXT;
  private readonly tracker = new ContextChangeTracker();
  /** True while a switch sets the on/off states, which are the new layout's already. */
  private applying = false;

  constructor(private readonly deps: LayoutSwitcherDeps) {}

  /** Call once, after the overlay manager has started. */
  start(): void {
    const { store, settings } = this.deps;
    // The overlay settings are what the app last ran with: the active layout follows them.
    store.captureEnabled(settings.getAll());
    settings.onChange((id, s) => {
      if (!this.applying) store.setEnabled(id, s.enabled);
    });
    settings.onRemove((id) => store.forgetInstance(id));
    store.onChange(() => this.notify());
  }

  state(): LayoutsState {
    const { store } = this.deps;
    return {
      layouts: store.views(),
      activeId: store.activeId,
      autoSwitch: store.autoSwitch,
      context: { ...this.context },
    };
  }

  /** Makes `id` the active layout and applies it. Returns false for an unknown id. */
  activate(id: string): boolean {
    const { store, overlays } = this.deps;
    const target = store.get(id);
    if (!target) return false;
    if (store.activeId === id) return true;
    overlays.flushSave();
    store.setActive(id);
    overlays.replaceLayout(target.bounds);
    this.applyEnabled();
    return true;
  }

  /**
   * Turns an instance on or off in one group. In the active group the window opens or closes
   * at once (through the overlay settings, which saves it here); otherwise only the group changes.
   */
  setEnabled(layoutId: string, instanceId: string, on: boolean): boolean {
    const { store, settings } = this.deps;
    if (!store.get(layoutId)) return false;
    if (layoutId !== store.activeId) return store.setEnabledIn(layoutId, instanceId, on);
    if (!settings.getAll()[instanceId]) return false;
    settings.update(instanceId, { enabled: on });
    return true;
  }

  /** Opens and closes windows so they match the active group (switched on and offered for its game). */
  private applyEnabled(): void {
    const { store, settings } = this.deps;
    this.applying = true;
    try {
      for (const [instanceId, current] of Object.entries(settings.getAll())) {
        const on = store.isOn(store.activeId, instanceId);
        if (current.enabled !== on) settings.update(instanceId, { enabled: on });
      }
    } finally {
      this.applying = false;
    }
  }

  /** A new group copying the active one; it becomes active (nothing moves). */
  create(): string | undefined {
    const id = this.deps.store.createFromActive();
    if (id !== undefined) this.activate(id);
    return id;
  }

  duplicate(id: string): string | undefined {
    return this.deps.store.duplicate(id);
  }

  rename(id: string, name: unknown): boolean {
    return this.deps.store.rename(id, name);
  }

  /** Deletes a layout; deleting the active one switches to Default first. */
  remove(id: string): boolean {
    const { store } = this.deps;
    if (id === DEFAULT_LAYOUT_ID || !store.get(id)) return false;
    if (store.activeId === id) this.activate(DEFAULT_LAYOUT_ID);
    return store.remove(id);
  }

  /** Changes a group's conditions; a new game on the active group opens and closes windows to fit. */
  setMatch(id: string, patch: unknown): boolean {
    const changed = this.deps.store.setMatch(id, patch);
    if (changed && id === this.deps.store.activeId) this.applyEnabled();
    return changed;
  }

  /** Turning the switch on applies the best layout for the current context right away. */
  setAutoSwitch(on: boolean): void {
    const { store } = this.deps;
    const was = store.autoSwitch;
    store.setAutoSwitch(on);
    if (on && !was) {
      this.tracker.reset();
      this.evaluate();
    }
  }

  /** The telemetry's (sim, car, session type) context; switches when it changed. */
  setContext(context: SimContext): void {
    this.context = { ...context };
    this.evaluate();
    this.notify();
  }

  private evaluate(): void {
    const { store } = this.deps;
    if (!store.autoSwitch || !this.tracker.observe(this.context)) return;
    this.activate(pickLayout(store.list(), this.context, DEFAULT_LAYOUT_ID));
  }

  private notify(): void {
    this.deps.onStateChange?.(this.state());
  }
}
