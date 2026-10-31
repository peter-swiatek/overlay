import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { defaultInstanceSettings } from "@overlay/overlays/settings";

/** Timer functions, injectable so tests need no real clock. */
export interface StoreTimer {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Per-overlay settings. Stub: keeps them in memory and does not touch `file` yet; the overlay
 * settings ticket adds validation, persistence and the debounced save.
 */
export class OverlaySettingsStore {
  private readonly items = new Map<string, OverlayInstanceSettings>();
  private readonly listeners = new Set<(id: string, settings: OverlayInstanceSettings) => void>();

  constructor(
    private readonly file: string,
    private readonly manifests: readonly OverlayManifest[],
    private readonly timer: StoreTimer = { setTimeout, clearTimeout },
  ) {
    void this.file;
    void this.timer;
    for (const manifest of manifests) {
      this.items.set(manifest.id, defaultInstanceSettings(manifest));
    }
  }

  getAll(): Record<string, OverlayInstanceSettings> {
    return Object.fromEntries(this.items);
  }

  get(id: string): OverlayInstanceSettings | undefined {
    return this.items.get(id);
  }

  /** Stub: ignores `patch`. Returns undefined for an unknown id. */
  update(id: string, patch: unknown): OverlayInstanceSettings | undefined {
    void patch;
    return this.items.get(id);
  }

  reset(id: string): OverlayInstanceSettings | undefined {
    const manifest = this.manifests.find((m) => m.id === id);
    if (!manifest) return undefined;
    const fresh = defaultInstanceSettings(manifest);
    this.items.set(id, fresh);
    for (const listener of this.listeners) listener(id, fresh);
    return fresh;
  }

  onChange(listener: (id: string, settings: OverlayInstanceSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Writes a pending debounced save now (called on quit). Nothing is pending in the stub. */
  flush(): void {}
}
