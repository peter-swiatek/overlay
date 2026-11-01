import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "../shared/app-settings-types";
import { AppSettingsStore, mergeAppSettings, sanitizeAppSettings } from "./app-settings";

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "app-settings-")), "app-settings.json");
}

describe("AppSettingsStore", () => {
  it("returns defaults for a missing or corrupt file", () => {
    const file = tmpFile();
    expect(new AppSettingsStore(file).load()).toEqual(DEFAULT_APP_SETTINGS);
    writeFileSync(file, "{not json");
    expect(new AppSettingsStore(file).load()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("drops unknown keys and replaces invalid values with defaults on load", () => {
    const file = tmpFile();
    writeFileSync(
      file,
      JSON.stringify({
        general: {
          units: "imperial",
          timeFormat: "13h",
          uiScalePct: 200,
          extra: 1,
          autoHide: "yes",
        },
        performance: { telemetryRateHz: 45, livePositions: false },
        other: { a: 1 },
      }),
    );
    const s = new AppSettingsStore(file).load();
    expect(s.general.units).toBe("imperial");
    expect(s.general.timeFormat).toBe("24h");
    expect(s.general.uiScalePct).toBe(100);
    expect(s.general.autoHide).toBe(false);
    expect(s.performance.telemetryRateHz).toBe(60);
    expect(s.performance.livePositions).toBe(false);
    expect("extra" in s.general).toBe(false);
    expect("other" in s).toBe(false);
  });

  it("fills the main-window keys from defaults when an older file lacks them", () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ general: { units: "imperial", startWithWindows: true } }));
    const s = new AppSettingsStore(file).load();
    expect(s.general.units).toBe("imperial");
    expect(s.general.startHiddenAtLogin).toBe(true);
    expect(s.general.closeAction).toBe("tray");
    expect(s.general.minimiseOnConnect).toBe(false);
    expect(s.general.welcomeDismissed).toBe(false);
    expect(s.ui).toEqual({ trayNoticeShown: false });
  });

  it("validates the main-window keys", () => {
    const m = (patch: unknown) => mergeAppSettings(DEFAULT_APP_SETTINGS, patch);
    expect(m({ general: { closeAction: "quit" } }).general.closeAction).toBe("quit");
    expect(m({ general: { closeAction: "minimise" } }).general.closeAction).toBe("tray");
    expect(m({ general: { startHiddenAtLogin: "no" } }).general.startHiddenAtLogin).toBe(true);
    expect(m({ general: { welcomeDismissed: true } }).general.welcomeDismissed).toBe(true);
    expect(m({ ui: { trayNoticeShown: true } }).ui.trayNoticeShown).toBe(true);
    expect(m({ ui: { trayNoticeShown: 1 } }).ui.trayNoticeShown).toBe(false);
  });

  it("validates each key", () => {
    const m = (patch: unknown) => mergeAppSettings(DEFAULT_APP_SETTINGS, patch);
    expect(m({ general: { uiScalePct: 125 } }).general.uiScalePct).toBe(125);
    expect(m({ general: { uiScalePct: "125" } }).general.uiScalePct).toBe(100);
    expect(m({ general: { units: "furlongs" } }).general.units).toBe("metric");
    expect(m({ general: { speedInMph: 1 } }).general.speedInMph).toBe(false);
    expect(m({ performance: { telemetryRateHz: 30 } }).performance.telemetryRateHz).toBe(30);
    expect(m({ performance: { telemetryRateHz: 120 } }).performance.telemetryRateHz).toBe(60);
    expect(m({ developer: { enabled: true } }).developer.enabled).toBe(true);
    expect(m({ appearance: { combinedLicencePill: null } }).appearance.combinedLicencePill).toBe(
      false,
    );
  });

  it("merges nested patches and ignores invalid parts", () => {
    const store = new AppSettingsStore(tmpFile());
    store.update({ general: { units: "imperial" } });
    const next = store.update({ general: { timeFormat: "12h", units: 5 }, performance: "bad" });
    expect(next.general.units).toBe("imperial");
    expect(next.general.timeFormat).toBe("12h");
    expect(store.update("junk")).toEqual(next);
    expect(store.update(null)).toEqual(next);
    expect(store.update([1])).toEqual(next);
  });

  it("is not polluted by __proto__ or constructor keys", () => {
    const store = new AppSettingsStore(tmpFile());
    const evil = JSON.parse(
      '{"__proto__":{"polluted":true},"general":{"__proto__":{"polluted":true},"constructor":1},"constructor":{"x":1}}',
    ) as unknown;
    const next = store.update(evil);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.keys(next)).toEqual(Object.keys(DEFAULT_APP_SETTINGS));
    expect(next).toEqual(DEFAULT_APP_SETTINGS);
    expect(sanitizeAppSettings(evil)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("notifies once per real change and persists", () => {
    const file = tmpFile();
    const store = new AppSettingsStore(file);
    const seen: boolean[] = [];
    const off = store.onChange((s) => seen.push(s.developer.enabled));
    store.update({ developer: { enabled: true } });
    store.update({ developer: { enabled: true } });
    store.update({ developer: { bogus: 1 } });
    expect(seen).toEqual([true]);
    const saved = JSON.parse(readFileSync(file, "utf8")) as typeof DEFAULT_APP_SETTINGS;
    expect(saved.developer.enabled).toBe(true);
    expect(new AppSettingsStore(file).load().developer.enabled).toBe(true);
    off();
    store.update({ developer: { enabled: false } });
    expect(seen).toEqual([true]);
  });
});
