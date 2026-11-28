import type { DisplaySettings } from "../shared/types";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  disableHardwareAcceleration: false,
  disableDirectComposition: false,
  opacityWorkaround: false,
  disableNativeOcclusion: false,
};

const KEYS = Object.keys(DEFAULT_DISPLAY_SETTINGS) as (keyof DisplaySettings)[];

/** Keeps only known boolean keys from untrusted data. */
export function sanitizeDisplaySettings(raw: unknown): Partial<DisplaySettings> {
  const out: Partial<DisplaySettings> = {};
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  for (const key of KEYS) {
    const value = record[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function parseDisplaySettings(raw: unknown): DisplaySettings {
  return { ...DEFAULT_DISPLAY_SETTINGS, ...sanitizeDisplaySettings(raw) };
}

export const SAFE_MODE_FLAG = "--safe-mode";

export function isSafeMode(argv: readonly string[]): boolean {
  return argv.includes(SAFE_MODE_FLAG);
}

/** Settings in effect for this run: the stored ones, or everything on with --safe-mode. */
export function resolveDisplaySettings(
  stored: DisplaySettings,
  safeMode: boolean,
): DisplaySettings {
  if (!safeMode) return stored;
  return {
    disableHardwareAcceleration: true,
    disableDirectComposition: true,
    opacityWorkaround: true,
    disableNativeOcclusion: true,
  };
}

export interface CommandLineSwitch {
  name: string;
  value?: string;
}

/**
 * Chromium switches for the settings in effect. Hardware acceleration is not a switch
 * (app.disableHardwareAcceleration). Every `disable-features` value must be joined in the one
 * switch, because a second appendSwitch for the same name replaces the first.
 */
export function buildCommandLineSwitches(settings: DisplaySettings): CommandLineSwitch[] {
  const switches: CommandLineSwitch[] = [];
  if (settings.disableDirectComposition) switches.push({ name: "disable-direct-composition" });
  const disabledFeatures: string[] = [];
  if (settings.disableNativeOcclusion) disabledFeatures.push("CalculateNativeWinOcclusion");
  if (disabledFeatures.length > 0) {
    switches.push({ name: "disable-features", value: disabledFeatures.join(",") });
  }
  return switches;
}

export class SettingsStore {
  constructor(private readonly file: string) {}

  load(): DisplaySettings {
    return parseDisplaySettings(readJsonFile(this.file));
  }

  update(patch: unknown): DisplaySettings {
    const next = { ...this.load(), ...sanitizeDisplaySettings(patch) };
    writeJsonFileAtomic(this.file, next);
    return next;
  }
}
