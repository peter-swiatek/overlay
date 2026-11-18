import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { defaultInstanceSettings } from "@overlay/overlays/settings";
import { OverlaySettingsStore, type StoreTimer } from "./overlay-settings-store";

const manifest: OverlayManifest = {
  id: "test",
  title: "Test",
  description: "",
  sims: ["iracing"],
  defaultSize: { width: 100, height: 100 },
  minSize: { width: 50, height: 50 },
  defaultPosition: { x: 0, y: 0 },
  table: false,
  fields: [{ id: "a", label: "A", defaultVisible: true }],
  settings: [{ key: "num", label: "Num", kind: "number", default: 10, min: 0, max: 20, step: 5 }],
  rateHz: 10,
  defaultEnabled: true,
};

class FakeTimer implements StoreTimer {
  pending: (() => void) | undefined;
  delay = 0;
  setTimeout(fn: () => void, ms: number): unknown {
    this.pending = fn;
    this.delay = ms;
    return fn;
  }
  clearTimeout(handle: unknown): void {
    if (this.pending === handle) this.pending = undefined;
  }
  fire(): void {
    const fn = this.pending;
    this.pending = undefined;
    fn?.();
  }
}

let dir: string;
let file: string;
let timer: FakeTimer;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-settings-"));
  file = join(dir, "overlay-settings.json");
  timer = new FakeTimer();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const make = () => new OverlaySettingsStore(file, [manifest], timer);
const saved = (): unknown => JSON.parse(readFileSync(file, "utf8"));

describe("OverlaySettingsStore", () => {
  it("starts with defaults when the file is missing", () => {
    expect(make().getAll()).toEqual({ test: defaultInstanceSettings(manifest) });
  });

  it("starts with defaults when the JSON is corrupt", () => {
    writeFileSync(file, "{ not json");
    expect(make().get("test")).toEqual(defaultInstanceSettings(manifest));
  });

  it("sanitises what it loads", () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        overlays: { test: { options: { num: 99 } }, retired: { enabled: true } },
      }),
    );
    const store = make();
    expect(store.get("test")?.options.num).toBe(20);
    expect(store.get("retired")).toBeUndefined();
  });

  it("saves after the debounce, not before", () => {
    const store = make();
    store.update("test", { options: { num: 5 } });
    expect(timer.delay).toBe(300);
    expect(existsSync(file)).toBe(false);
    timer.fire();
    expect(saved()).toEqual({ version: 1, overlays: { test: store.get("test") } });
  });

  it("restarts the debounce on each change and writes once", () => {
    const store = make();
    store.update("test", { options: { num: 5 } });
    store.update("test", { options: { num: 15 } });
    timer.fire();
    expect(
      (saved() as { overlays: { test: OverlayInstanceSettings } }).overlays.test.options.num,
    ).toBe(15);
    expect(timer.pending).toBeUndefined();
  });

  it("flush writes now and cancels the timer", () => {
    const store = make();
    store.update("test", { enabled: false });
    store.flush();
    expect(existsSync(file)).toBe(true);
    expect(timer.pending).toBeUndefined();
  });

  it("flush writes nothing when nothing changed", () => {
    make().flush();
    expect(existsSync(file)).toBe(false);
  });

  it("reset restores the defaults and saves", () => {
    const store = make();
    store.update("test", { enabled: false });
    expect(store.reset("test")).toEqual(defaultInstanceSettings(manifest));
    store.flush();
    expect((saved() as { overlays: { test: OverlayInstanceSettings } }).overlays.test.enabled).toBe(
      true,
    );
  });

  it("calls listeners once per real change and not for a no-op", () => {
    const store = make();
    const listener = vi.fn();
    const off = store.onChange(listener);
    store.update("test", { options: { num: 5 } });
    store.update("test", { options: { num: 5 } });
    store.update("test", { options: { num: "bad" } });
    store.update("test", null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("test", store.get("test"));
    store.reset("test");
    expect(listener).toHaveBeenCalledTimes(2);
    store.reset("test");
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    store.update("test", { enabled: false });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns undefined for an unknown id", () => {
    const store = make();
    expect(store.get("nope")).toBeUndefined();
    expect(store.update("nope", { enabled: false })).toBeUndefined();
    expect(store.reset("nope")).toBeUndefined();
  });

  it("keeps running when the write fails", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new OverlaySettingsStore(
      join(dir, "overlay-settings.json", "x", "y.json"),
      [manifest],
      timer,
    );
    writeFileSync(file, "a file where a directory is needed");
    store.update("test", { enabled: false });
    expect(() => store.flush()).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
