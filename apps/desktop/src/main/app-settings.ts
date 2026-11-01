import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsPatch,
} from "../shared/app-settings-types";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";

type Validator<T> = (value: unknown) => T | undefined;

const bool: Validator<boolean> = (v) => (typeof v === "boolean" ? v : undefined);
function oneOf<T extends string | number>(allowed: readonly T[]): Validator<T> {
  return (v) => allowed.find((a) => a === v);
}

type Validators = {
  [S in keyof AppSettings]: { [K in keyof AppSettings[S]]: Validator<AppSettings[S][K]> };
};

/** Every known key with its validator. Anything else in a file or patch is dropped. */
const VALIDATORS: Validators = {
  general: {
    units: oneOf(["metric", "imperial"] as const),
    speedInMph: bool,
    timeFormat: oneOf(["24h", "12h"] as const),
    startWithWindows: bool,
    autoHide: bool,
    uiScalePct: oneOf([100, 110, 125, 150] as const),
    startHiddenAtLogin: bool,
    closeAction: oneOf(["tray", "quit"] as const),
    minimiseOnConnect: bool,
    welcomeDismissed: bool,
  },
  ui: { trayNoticeShown: bool },
  performance: {
    telemetryRateHz: oneOf([30, 60] as const),
    livePositions: bool,
    reduceVisualEffects: bool,
  },
  appearance: { combinedLicencePill: bool },
  developer: { enabled: bool },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges `raw` (a full file or a patch) over `base`, keeping only known sections and keys whose
 * value passes its validator. Reads own properties only, so `__proto__` and friends are inert.
 */
export function mergeAppSettings(base: AppSettings, raw: unknown): AppSettings {
  const next = structuredClone(base);
  if (!isRecord(raw)) return next;
  for (const section of Object.keys(VALIDATORS) as (keyof AppSettings)[]) {
    if (!Object.hasOwn(raw, section)) continue;
    const patch = raw[section];
    if (!isRecord(patch)) continue;
    const validators = VALIDATORS[section] as Record<string, Validator<unknown>>;
    const target = next[section] as Record<string, unknown>;
    for (const key of Object.keys(validators)) {
      if (!Object.hasOwn(patch, key)) continue;
      const value = validators[key]?.(patch[key]);
      if (value !== undefined) target[key] = value;
    }
  }
  return next;
}

/** Fills defaults for missing or invalid values (load path). */
export function sanitizeAppSettings(raw: unknown): AppSettings {
  return mergeAppSettings(DEFAULT_APP_SETTINGS, raw);
}

export class AppSettingsStore {
  private current: AppSettings = structuredClone(DEFAULT_APP_SETTINGS);
  private loaded = false;
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(private readonly file: string) {}

  load(): AppSettings {
    if (!this.loaded) {
      this.current = sanitizeAppSettings(readJsonFile(this.file));
      this.loaded = true;
    }
    return this.current;
  }

  update(patch: unknown): AppSettings {
    const before = this.load();
    const next = mergeAppSettings(before, patch);
    if (JSON.stringify(next) === JSON.stringify(before)) return before;
    this.current = next;
    try {
      writeJsonFileAtomic(this.file, next);
    } catch (err) {
      console.error("Could not save app settings", err);
    }
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

export type { AppSettingsPatch };
