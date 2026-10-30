import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureSettingsStore, parseCaptureSettings } from "./capture-settings";

describe("capture settings", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to 5 Hz and clamps to 1..20", () => {
    expect(parseCaptureSettings(undefined)).toEqual({ lmuFrameHz: 5 });
    expect(parseCaptureSettings({ lmuFrameHz: 100 })).toEqual({ lmuFrameHz: 20 });
    expect(parseCaptureSettings({ lmuFrameHz: 0 })).toEqual({ lmuFrameHz: 1 });
    expect(parseCaptureSettings({ lmuFrameHz: "fast" })).toEqual({ lmuFrameHz: 5 });
  });

  it("persists updates and ignores unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "capture-settings-"));
    dirs.push(dir);
    const store = new CaptureSettingsStore(join(dir, "s.json"));
    expect(store.update({ lmuFrameHz: 10, extra: 1 })).toEqual({ lmuFrameHz: 10 });
    expect(store.load()).toEqual({ lmuFrameHz: 10 });
  });
});
