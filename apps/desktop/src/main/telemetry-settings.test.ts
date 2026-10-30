import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TelemetrySettingsStore, parseTelemetrySettings } from "./telemetry-settings";

describe("telemetry settings", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const tempFile = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "telemetry-settings-"));
    dirs.push(dir);
    return join(dir, "telemetry-settings.json");
  };

  it("defaults to auto, no file, normal speed", () => {
    const defaults = { source: "auto", replayPath: null, replaySpeed: 1, retentionDays: 60 };
    expect(parseTelemetrySettings(undefined)).toEqual(defaults);
    expect(parseTelemetrySettings("x")).toEqual(defaults);
    expect(parseTelemetrySettings({})).toEqual(defaults);
  });

  it("accepts every source and rejects unknown ones", () => {
    for (const source of ["auto", "iracing", "lmu", "replay", "mock"]) {
      expect(parseTelemetrySettings({ source }).source).toBe(source);
    }
    expect(parseTelemetrySettings({ source: "rf2" }).source).toBe("auto");
    expect(parseTelemetrySettings({ source: 3 }).source).toBe("auto");
  });

  it("accepts only a non-empty string as replayPath", () => {
    expect(parseTelemetrySettings({ replayPath: "C:/a.ovfx" }).replayPath).toBe("C:/a.ovfx");
    expect(parseTelemetrySettings({ replayPath: "" }).replayPath).toBeNull();
    expect(parseTelemetrySettings({ replayPath: 5 }).replayPath).toBeNull();
  });

  it("keeps replaySpeed finite and within 0..16", () => {
    expect(parseTelemetrySettings({ replaySpeed: 0 }).replaySpeed).toBe(0);
    expect(parseTelemetrySettings({ replaySpeed: 2.5 }).replaySpeed).toBe(2.5);
    expect(parseTelemetrySettings({ replaySpeed: 100 }).replaySpeed).toBe(16);
    expect(parseTelemetrySettings({ replaySpeed: -1 }).replaySpeed).toBe(0);
    expect(parseTelemetrySettings({ replaySpeed: Number.NaN }).replaySpeed).toBe(1);
    expect(parseTelemetrySettings({ replaySpeed: Infinity }).replaySpeed).toBe(1);
    expect(parseTelemetrySettings({ replaySpeed: "2" }).replaySpeed).toBe(1);
  });

  it("keeps telemetry files at least 30 days and 60 by default", () => {
    expect(parseTelemetrySettings({ retentionDays: 90 }).retentionDays).toBe(90);
    expect(parseTelemetrySettings({ retentionDays: 5 }).retentionDays).toBe(30);
    expect(parseTelemetrySettings({ retentionDays: "x" }).retentionDays).toBe(60);
  });

  it("persists updates, merges patches and ignores unknown keys", () => {
    const file = tempFile();
    const store = new TelemetrySettingsStore(file);
    expect(store.update({ source: "replay", replayPath: "C:/a.ovfx", extra: 1 })).toEqual({
      source: "replay",
      replayPath: "C:/a.ovfx",
      replaySpeed: 1,
      retentionDays: 60,
    });
    expect(store.update({ replaySpeed: 4 })).toEqual({
      source: "replay",
      replayPath: "C:/a.ovfx",
      replaySpeed: 4,
      retentionDays: 60,
    });
    expect(new TelemetrySettingsStore(file).load().replaySpeed).toBe(4);
  });

  it("falls back to defaults for a corrupt file", () => {
    const file = tempFile();
    writeFileSync(file, "{not json");
    expect(new TelemetrySettingsStore(file).load().source).toBe("auto");
  });
});
