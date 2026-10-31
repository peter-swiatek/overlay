import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_PRESETS } from "@overlay/theme";
import type { Theme } from "@overlay/theme/types";
import { MAX_CUSTOM_THEMES, ThemeStore } from "./theme-store";

const graphite = THEME_PRESETS[0] as Theme;
const custom = (n: number, extra: Partial<Theme> = {}): Theme => ({
  ...graphite,
  id: `custom-${String(n).padStart(8, "0")}`,
  name: `Mine ${n}`,
  ...extra,
});

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "themes-"));
  file = join(dir, "themes.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ThemeStore loading", () => {
  it("starts with Graphite and no custom themes when the file is missing", () => {
    const store = new ThemeStore(file);
    expect(store.getActive().id).toBe("graphite");
    expect(store.getState()).toMatchObject({ activeId: "graphite", custom: [] });
    expect(store.getState().presets).toHaveLength(6);
  });

  it("survives a corrupt file", () => {
    writeFileSync(file, "{not json");
    expect(new ThemeStore(file).getActive().id).toBe("graphite");
  });

  it("drops invalid, duplicate and non-custom themes and an unknown active id", () => {
    const good = custom(1);
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        activeId: "custom-gone",
        custom: [good, good, { ...custom(2), tokens: {} }, { ...custom(3), id: "midnight" }, 5],
      }),
    );
    const store = new ThemeStore(file);
    expect(store.getState().custom).toEqual([good]);
    expect(store.getActive().id).toBe("graphite");
  });

  it("restores a saved active custom theme", () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, activeId: "custom-00000004", custom: [custom(4)] }),
    );
    expect(new ThemeStore(file).getActive().name).toBe("Mine 4");
  });
});

describe("ThemeStore changes", () => {
  it("saves, replaces and persists", () => {
    const store = new ThemeStore(file);
    store.save(custom(1));
    store.save(custom(1, { name: "Renamed" }));
    store.save(custom(2));
    expect(store.getState().custom.map((t) => t.name)).toEqual(["Renamed", "Mine 2"]);
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as { version: number; custom: Theme[] };
    expect(onDisk.version).toBe(1);
    expect(onDisk.custom).toHaveLength(2);
    expect(new ThemeStore(file).getState().custom).toHaveLength(2);
  });

  it("rejects preset ids, non-custom ids and invalid themes", () => {
    const store = new ThemeStore(file);
    expect(() => store.save({ ...graphite })).toThrow();
    expect(() => store.save({ ...custom(1), id: "midnight" })).toThrow();
    expect(() => store.save({ ...custom(1), tokens: {} })).toThrow();
    expect(() => store.save("nope")).toThrow();
    expect(store.getState().custom).toEqual([]);
  });

  it("caps custom themes at 50 but still lets one be replaced", () => {
    const store = new ThemeStore(file);
    for (let i = 0; i < MAX_CUSTOM_THEMES; i++) store.save(custom(i));
    expect(() => store.save(custom(99))).toThrow();
    expect(() => store.save(custom(3, { name: "Edited" }))).not.toThrow();
    expect(store.getState().custom).toHaveLength(MAX_CUSTOM_THEMES);
  });

  it("sets the active theme and ignores unknown ids", () => {
    const store = new ThemeStore(file);
    store.save(custom(1));
    expect(store.setActive("custom-00000001").activeId).toBe("custom-00000001");
    expect(store.setActive("nope").activeId).toBe("custom-00000001");
    expect(store.setActive("aurora").activeId).toBe("aurora");
  });

  it("falls back to Graphite when the active theme is removed", () => {
    const store = new ThemeStore(file);
    store.save(custom(1));
    store.setActive("custom-00000001");
    expect(store.remove("custom-00000001")).toMatchObject({ activeId: "graphite", custom: [] });
    expect(store.getActive().id).toBe("graphite");
  });

  it("does not remove presets", () => {
    const store = new ThemeStore(file);
    store.remove("midnight");
    expect(store.getState().presets).toHaveLength(6);
  });
});

describe("ThemeStore listeners", () => {
  it("fires when the active theme or its content changes, not otherwise", () => {
    const store = new ThemeStore(file);
    const listener = vi.fn();
    const off = store.onChange(listener);
    store.save(custom(1));
    expect(listener).not.toHaveBeenCalled();
    store.setActive("custom-00000001");
    expect(listener).toHaveBeenCalledTimes(1);
    store.setActive("custom-00000001");
    store.save(custom(2));
    expect(listener).toHaveBeenCalledTimes(1);
    store.save(custom(1, { name: "Changed" }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Changed" }));
    store.remove("custom-00000001");
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ id: "graphite" }));
    off();
    store.setActive("aurora");
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
