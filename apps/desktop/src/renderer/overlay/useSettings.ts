import { useEffect, useState } from "react";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import type { AppSettings } from "../../shared/app-settings-types";

/** This overlay's settings: loaded once, then following `overlays:changed` for its id. */
export function useOverlaySettings(id: string): OverlayInstanceSettings | null {
  const [settings, setSettings] = useState<OverlayInstanceSettings | null>(null);
  useEffect(() => {
    let changed = false;
    const off = window.overlayApi.overlays.onChanged((changedId, next) => {
      if (changedId !== id) return;
      changed = true;
      setSettings(next);
    });
    void window.overlayApi.overlays.get(id).then((loaded) => {
      // A change that arrived while loading is newer than the loaded value.
      if (!changed && loaded !== null) setSettings(loaded);
    });
    return off;
  }, [id]);
  return settings;
}

/** App-wide settings: loaded once, then following `app-settings:changed`. */
export function useAppSettings(): AppSettings | null {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    let changed = false;
    const off = window.overlayApi.appSettings.onChanged((next) => {
      changed = true;
      setSettings(next);
    });
    void window.overlayApi.appSettings.get().then((loaded) => {
      if (!changed) setSettings(loaded);
    });
    return off;
  }, []);
  return settings;
}

/** Follows edit mode (overlays unlocked). */
export function useEditMode(): boolean {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    void window.overlayApi.getEditMode().then(setEditing);
    return window.overlayApi.onEditModeChanged(setEditing);
  }, []);
  return editing;
}
