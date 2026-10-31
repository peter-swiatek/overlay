import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_SETTINGS,
  SettingsStore,
  isSafeMode,
  parseDisplaySettings,
  resolveDisplaySettings,
} from "./settings";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-settings-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("settings", () => {
  it("defaults everything off", () => {
    expect(parseDisplaySettings(undefined)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("persists partial updates and ignores junk", () => {
    const store = new SettingsStore(join(dir, "settings.json"));
    store.update({ opacityWorkaround: true, bogus: true, disableDirectComposition: "yes" });
    expect(store.load()).toEqual({ ...DEFAULT_DISPLAY_SETTINGS, opacityWorkaround: true });
    store.update({ disableHardwareAcceleration: true });
    expect(store.load()).toEqual({
      disableHardwareAcceleration: true,
      disableDirectComposition: false,
      opacityWorkaround: true,
      disableNativeOcclusion: false,
    });
  });

  it("--safe-mode enables all fallbacks without touching stored values", () => {
    expect(isSafeMode(["electron", "--safe-mode"])).toBe(true);
    expect(isSafeMode(["electron"])).toBe(false);
    expect(resolveDisplaySettings(DEFAULT_DISPLAY_SETTINGS, true)).toEqual({
      disableHardwareAcceleration: true,
      disableDirectComposition: true,
      opacityWorkaround: true,
      disableNativeOcclusion: true,
    });
    expect(resolveDisplaySettings(DEFAULT_DISPLAY_SETTINGS, false)).toEqual(
      DEFAULT_DISPLAY_SETTINGS,
    );
  });
});
