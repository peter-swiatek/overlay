import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import {
  applySettingsPatch,
  defaultInstanceSettings,
  parseOverlaySettingsFile,
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

/** Per-overlay settings: sanitised on load and on every patch, saved after a short debounce. */
export class OverlaySettingsStore {
  private readonly items = new Map<string, OverlayInstanceSettings>();
  private readonly listeners = new Set<(id: string, settings: OverlayInstanceSettings) => void>();
  private saveTimer: unknown;
  private dirty = false;

  constructor(
    private readonly file: string,
    private readonly manifests: readonly OverlayManifest[],
    private readonly timer: StoreTimer = { setTimeout, clearTimeout },
  ) {
    const loaded = parseOverlaySettingsFile(readJsonFile(file), manifests);
    for (const manifest of manifests) {
      const settings = loaded.overlays[manifest.id];
      if (settings) this.items.set(manifest.id, settings);
    }
  }

  getAll(): Record<string, OverlayInstanceSettings> {
    return Object.fromEntries(this.items);
  }

  get(id: string): OverlayInstanceSettings | undefined {
    return this.items.get(id);
  }

  /** Returns undefined for an unknown id. Invalid parts of `patch` are ignored. */
  update(id: string, patch: unknown): OverlayInstanceSettings | undefined {
    const manifest = this.manifests.find((m) => m.id === id);
    const current = this.items.get(id);
    if (!manifest || !current) return undefined;
    return this.commit(id, applySettingsPatch(manifest, current, patch));
  }

  reset(id: string): OverlayInstanceSettings | undefined {
    const manifest = this.manifests.find((m) => m.id === id);
    if (!manifest) return undefined;
    return this.commit(id, defaultInstanceSettings(manifest));
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
