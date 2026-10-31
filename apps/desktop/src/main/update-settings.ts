import { readJsonFile, writeJsonFileAtomic } from "./json-file";

export interface UpdateSettings {
  /** Also offer prereleases ("test builds"). */
  allowPrerelease: boolean;
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { allowPrerelease: false };

/** The file holds `{ "updates": { ... } }` so other sections can join it later. */
export function parseUpdateSettings(raw: unknown): UpdateSettings {
  const out = { ...DEFAULT_UPDATE_SETTINGS };
  if (typeof raw !== "object" || raw === null) return out;
  const section = (raw as Record<string, unknown>)["updates"];
  if (typeof section !== "object" || section === null) return out;
  const flag = (section as Record<string, unknown>)["allowPrerelease"];
  if (typeof flag === "boolean") out.allowPrerelease = flag;
  return out;
}

export interface UpdateSettingsStorage {
  load(): UpdateSettings;
  update(patch: Partial<UpdateSettings>): UpdateSettings;
}

export class UpdateSettingsStore implements UpdateSettingsStorage {
  constructor(private readonly file: string) {}

  load(): UpdateSettings {
    return parseUpdateSettings(readJsonFile(this.file));
  }

  update(patch: Partial<UpdateSettings>): UpdateSettings {
    const next = parseUpdateSettings({ updates: { ...this.load(), ...patch } });
    writeJsonFileAtomic(this.file, { updates: next });
    return next;
  }
}
