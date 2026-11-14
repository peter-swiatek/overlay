import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import {
  isAddedInstance,
  manifestForInstance,
  nextInstanceId,
  parseInstanceId,
} from "@overlay/overlays/instances";
import {
  applySettingsPatch,
  newInstanceSettings,
  parseOverlaySettingsFile,
  resetInstanceSettings,
} from "@overlay/overlays/settings";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";

/** Timer functions, injectable so tests need no real clock. */
export interface StoreTimer {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SAVE_DEBOUNCE_MS = 300;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Settings of every overlay instance, keyed by instance id (the manifest id for instance 1,
 * "<manifest id>:<n>" for added ones): sanitised on load and on every patch, saved after a short
 * debounce. Instance 1 of every overlay always exists; added instances come and go.
 */
export class OverlaySettingsStore {
  private readonly items = new Map<string, OverlayInstanceSettings>();
  private readonly listeners = new Set<(id: string, settings: OverlayInstanceSettings) => void>();
  private readonly removeListeners = new Set<(id: string) => void>();
  private saveTimer: unknown;
  private dirty = false;

  constructor(
    private readonly file: string,
    private readonly manifests: readonly OverlayManifest[],
    private readonly timer: StoreTimer = { setTimeout, clearTimeout },
  ) {
    const loaded = parseOverlaySettingsFile(readJsonFile(file), manifests);
    for (const [id, settings] of Object.entries(loaded.overlays)) this.items.set(id, settings);
  }

  getAll(): Record<string, OverlayInstanceSettings> {
    return Object.fromEntries(this.items);
  }

  get(id: string): OverlayInstanceSettings | undefined {
    return this.items.get(id);
  }

  /** Returns undefined for an unknown id. Invalid parts of `patch` are ignored. */
  update(id: string, patch: unknown): OverlayInstanceSettings | undefined {
    const manifest = manifestForInstance(id, this.manifests);
    const current = this.items.get(id);
    if (!manifest || !current) return undefined;
    return this.commit(id, applySettingsPatch(manifest, current, patch));
  }

  /** Back to defaults; an added instance keeps its enabled state and name. */
  reset(id: string): OverlayInstanceSettings | undefined {
    const manifest = manifestForInstance(id, this.manifests);
    const current = this.items.get(id);
    if (!manifest || !current) return undefined;
    return this.commit(id, resetInstanceSettings(manifest, current, id));
  }

  /**
   * Adds an instance of the overlay that `sourceId` is an instance of, with a copy of the
   * source's settings (see `newInstanceSettings`), switched on. Returns the new id, or undefined
   * for an unknown source or when the overlay already has the most instances. Listeners hear
   * about it as a change.
   */
  addInstance(sourceId: string): string | undefined {
    const manifest = manifestForInstance(sourceId, this.manifests);
    const source = this.items.get(sourceId);
    if (!manifest || !source) return undefined;
    const id = nextInstanceId(manifest.id, this.items.keys());
    if (id === null) return undefined;
    this.commit(id, newInstanceSettings(manifest, source, id));
    return id;
  }

  /** Removes an added instance; instance 1 cannot be removed. Returns whether one was removed. */
  removeInstance(id: string): boolean {
    if (!isAddedInstance(id) || parseInstanceId(id) === null || !this.items.delete(id)) {
      return false;
    }
    this.dirty = true;
    this.scheduleSave();
    for (const listener of this.removeListeners) listener(id);
    return true;
  }

  onRemove(listener: (id: string) => void): () => void {
    this.removeListeners.add(listener);
    return () => {
      this.removeListeners.delete(listener);
    };
  }

  onChange(listener: (id: string, settings: OverlayInstanceSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Writes a pending debounced save now (called on quit). */
  flush(): void {
    if (this.saveTimer !== undefined) {
      this.timer.clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      writeJsonFileAtomic(this.file, { version: 1, overlays: this.getAll() });
    } catch (error) {
      console.error("Could not save overlay settings", error);
    }
  }

  private commit(id: string, next: OverlayInstanceSettings): OverlayInstanceSettings {
    const current = this.items.get(id);
    if (current && sameJson(current, next)) return current;
    this.items.set(id, next);
    this.dirty = true;
    this.scheduleSave();
    for (const listener of this.listeners) listener(id, next);
    return next;
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) this.timer.clearTimeout(this.saveTimer);
    this.saveTimer = this.timer.setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
  }
}
