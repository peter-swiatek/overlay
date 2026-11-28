import { useCallback, useEffect, useState } from "react";
import type { AppSettings, AppSettingsPatch } from "../../../shared/app-settings-types";

/** Loads the app settings, follows changes from other windows and the tray, and saves patches. */
export function useAppSettings(): {
  settings: AppSettings | null;
  update(patch: AppSettingsPatch): void;
} {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    const api = window.overlayApi.appSettings;
    let alive = true;
    void api.get().then((s) => {
      if (alive) setSettings(s);
    });
    const off = api.onChanged(setSettings);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const update = useCallback((patch: AppSettingsPatch): void => {
    void window.overlayApi.appSettings.update(patch).then(setSettings);
  }, []);

  return { settings, update };
}
