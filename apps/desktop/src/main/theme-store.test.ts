import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TYPOGRAPHY, THEME_PRESETS } from "@overlay/theme";
import type { Theme, Typography } from "@overlay/theme/types";
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
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
      version: number;
      custom: Theme[];
      typography: Typography;
    };
    expect(onDisk.version).toBe(2);
    expect(onDisk.custom).toHaveLength(2);
    expect(onDisk.typography).toEqual(DEFAULT_TYPOGRAPHY);
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

  it("refuses every preset id, even with a valid custom body", () => {
    const store = new ThemeStore(file);
    for (const preset of THEME_PRESETS) {
      expect(() => store.save({ ...custom(1), id: preset.id })).toThrow();
      expect(() => store.save(preset)).toThrow();
    }
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
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ name: "Changed" }) }),
    );
    store.remove("custom-00000001");
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ id: "graphite" }) }),
    );
    store.setTypography({ compact: true });
    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith({
      theme: expect.objectContaining({ id: "graphite" }),
      typography: { ...DEFAULT_TYPOGRAPHY, compact: true },
    });
    store.setTypography({ compact: true });
    expect(listener).toHaveBeenCalledTimes(4);
    off();
    store.setActive("aurora");
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe("ThemeStore typography", () => {
  const mine: Typography = { font: "oswald", weight: 700, compact: true };

  it("starts with the defaults on a fresh install", () => {
    expect(new ThemeStore(file).getState().typography).toEqual(DEFAULT_TYPOGRAPHY);
    expect(new ThemeStore(file).getApplied()).toEqual({
      theme: THEME_PRESETS[0],
      typography: DEFAULT_TYPOGRAPHY,
    });
  });

  it("can be changed with a built-in theme active, field by field, and persists", () => {
    const store = new ThemeStore(file);
    expect(store.getActive().id).toBe("graphite");
    store.setTypography({ font: "oswald" });
    store.setTypography({ weight: 700, compact: true });
    expect(store.getState().typography).toEqual(mine);
    expect(new ThemeStore(file).getState().typography).toEqual(mine);
  });

  it("ignores invalid fields", () => {
    const store = new ThemeStore(file);
    store.setTypography(mine);
    store.setTypography({ font: "comic", weight: 550, compact: "yes" });
    store.setTypography(null);
    expect(store.getState().typography).toEqual(mine);
  });

  it("does not change when the theme changes", () => {
    const store = new ThemeStore(file);
    store.save(custom(1));
    store.setTypography(mine);
    for (const id of [...THEME_PRESETS.map((t) => t.id), "custom-00000001", "graphite"]) {
      store.setActive(id);
      expect(store.getApplied().typography).toEqual(mine);
    }
    store.remove("custom-00000001");
    expect(store.getState().typography).toEqual(mine);
  });

  it("sanitises a version 2 file", () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        activeId: "carbon",
        custom: [],
        typography: { font: "manrope", weight: 3, compact: true },
      }),
    );
    expect(new ThemeStore(file).getState().typography).toEqual({
      ...DEFAULT_TYPOGRAPHY,
      font: "manrope",
      compact: true,
    });
  });
});

describe("ThemeStore migration from version 1", () => {
  /** A custom theme as version 1 stored it, typography inside. */
  const legacy = (n: number, typography: Typography) => ({ ...custom(n), ...typography });

  it("lifts the active custom theme's typography out once and drops it from the themes", () => {
    const active: Typography = { font: "manrope", weight: 400, compact: true };
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        activeId: "custom-00000002",
        custom: [legacy(1, { font: "oswald", weight: 800, compact: false }), legacy(2, active)],
      }),
    );
    const store = new ThemeStore(file);
    expect(store.getState().typography).toEqual(active);
    expect(store.getActive().id).toBe("custom-00000002");
    for (const t of store.getState().custom) {
      expect(Object.keys(t).sort()).toEqual(["id", "name", "tokens"]);
    }
    // Rewritten as version 2 at once, so the migration never runs again.
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(onDisk.version).toBe(2);
    expect(onDisk.typography).toEqual(active);
    expect(JSON.stringify(onDisk.custom)).not.toMatch(/"font"|"weight"|"compact"/);
    // A later change sticks: switching theme does not bring the old values back.
    store.setActive("custom-00000001");
    store.setTypography({ weight: 600 });
    expect(new ThemeStore(file).getState().typography).toEqual({ ...active, weight: 600 });
  });

  it("keeps what an active built-in theme used to show", () => {
    writeFileSync(file, JSON.stringify({ version: 1, activeId: "carbon", custom: [] }));
    expect(new ThemeStore(file).getState().typography).toEqual({
      font: "barlow-condensed",
      weight: 600,
      compact: true,
    });
  });

  it("uses the defaults when the active theme is unknown", () => {
    writeFileSync(file, JSON.stringify({ version: 1, activeId: "custom-gone", custom: [] }));
    expect(new ThemeStore(file).getState().typography).toEqual(DEFAULT_TYPOGRAPHY);
  });
});
