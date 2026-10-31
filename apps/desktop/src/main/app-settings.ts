import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsPatch,
} from "../shared/app-settings-types";

/** App-wide settings. Stub: in memory, shallow-merges each section, does not touch `file` yet. */
export class AppSettingsStore {
  private current: AppSettings = structuredClone(DEFAULT_APP_SETTINGS);
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(private readonly file: string) {
    void this.file;
  }

  load(): AppSettings {
    return this.current;
  }

  update(patch: unknown): AppSettings {
    if (typeof patch !== "object" || patch === null) return this.current;
    const next = structuredClone(this.current);
    for (const key of Object.keys(next) as (keyof AppSettings)[]) {
      const section = (patch as AppSettingsPatch)[key];
      if (typeof section === "object" && section !== null) Object.assign(next[key], section);
    }
    this.current = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }

  onChange(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
