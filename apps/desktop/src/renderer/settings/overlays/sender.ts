import type {
  OverlayInstanceSettings,
  OverlayManifest,
  OverlaySettingsPatch,
} from "@overlay/overlays/contract";
import { applySettingsPatch } from "@overlay/overlays/settings";
import { settingsOf } from "./model";
import type { Debouncer } from "./debounce";

export type AllSettings = Record<string, OverlayInstanceSettings>;

export interface SenderDeps {
  manifests: readonly OverlayManifest[];
  debouncer: Debouncer;
  /** Sends one patch to main. */
  update(id: string, patch: OverlaySettingsPatch): Promise<unknown>;
  /** Receives every new optimistic state. */
  publish(next: AllSettings): void;
}

interface Pending {
  id: string;
  patch: OverlaySettingsPatch;
}

export interface OverlaySender {
  /** Seeds or replaces the whole state (initial load). */
  load(all: AllSettings): void;
  /** Applies a patch locally at once and sends it, debounced when a key is given. */
  send(id: string, patch: OverlaySettingsPatch, debounceKey?: string): void;
  /** An instance changed in main: re-applies patches main has not confirmed yet on top of it. */
  incoming(id: string, settings: OverlayInstanceSettings): void;
}

/**
 * The settings page's write path. Slider patches are debounced, so for a while the page holds
 * changes main does not know about; this keeps them from being lost or undone:
 * - any non-debounced send flushes the debounced ones first, so they go out in order;
 * - a debounced column-list patch is rebuilt from the latest state when its timer fires, so
 *   it cannot revert a reorder or visibility change made in the meantime;
 * - echoes of earlier sends are not allowed to overwrite patches still unsent or in flight.
 */
export function createOverlaySender(deps: SenderDeps): OverlaySender {
  let all: AllSettings = {};
  let seq = 0;
  /** Unsent (debounced) and in-flight patches by token, oldest first. */
  const pending = new Map<number, Pending>();
  const unsentByKey = new Map<string, number>();

  function manifestOf(id: string): OverlayManifest | undefined {
    return deps.manifests.find((m) => m.id === id);
  }

  function applyLocal(id: string, patch: OverlaySettingsPatch): void {
    const manifest = manifestOf(id);
    if (!manifest) return;
    all = { ...all, [id]: applySettingsPatch(manifest, settingsOf(manifest, all), patch) };
    deps.publish(all);
  }

  function dropFieldPatches(id: string): void {
    for (const [token, p] of pending) {
      if (p.id === id && p.patch.common?.fields !== undefined) {
        pending.delete(token);
        for (const [key, t] of unsentByKey) if (t === token) unsentByKey.delete(key);
      }
    }
  }

  function transmit(token: number, id: string, patch: OverlaySettingsPatch): void {
    pending.set(token, { id, patch });
    const done = (): void => void pending.delete(token);
    void deps.update(id, patch).then(done, done);
  }

  return {
    load(next) {
      all = next;
      deps.publish(all);
    },
    send(id, patch, debounceKey) {
      const manifest = manifestOf(id);
      if (!manifest) return;
      if (debounceKey === undefined) deps.debouncer.flush();
      applyLocal(id, patch);
      // Read before a whole-list patch below drops the replaced one.
      const key = `${id}:${debounceKey}`;
      const old = unsentByKey.get(key);
      const oldOptions = old === undefined ? undefined : pending.get(old)?.patch.options;
      // A whole-list patch supersedes older ones: it is built from the optimistic state.
      if (patch.common?.fields !== undefined) dropFieldPatches(id);
      const token = ++seq;
      if (debounceKey === undefined) {
        transmit(token, id, patch);
        return;
      }
      // The replaced patch may carry options the newer one lacks (Auto to Custom, then more drag
      // ticks): keep them, or main would never hear about the mode switch.
      if (old !== undefined) pending.delete(old);
      const outgoing: OverlaySettingsPatch = oldOptions
        ? { ...patch, options: { ...oldOptions, ...patch.options } }
        : patch;
      unsentByKey.set(key, token);
      pending.set(token, { id, patch: outgoing });
      deps.debouncer.schedule(key, () => {
        if (unsentByKey.get(key) !== token) return;
        unsentByKey.delete(key);
        const fields = outgoing.common?.fields;
        const latest = settingsOf(manifest, all).common.fields;
        const sendNow =
          fields === undefined
            ? outgoing
            : { ...outgoing, common: { ...outgoing.common, fields: latest } };
        transmit(token, id, sendNow);
      });
    },
    incoming(id, settings) {
      const manifest = manifestOf(id);
      let next = settings;
      if (manifest) {
        for (const p of pending.values()) {
          if (p.id === id) next = applySettingsPatch(manifest, next, p.patch);
        }
      }
      all = { ...all, [id]: next };
      deps.publish(all);
    },
  };
}
