import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import { DEFAULT_LAYOUT_ID } from "../shared/layout-types";
import type { Layout } from "./layout";
import { LayoutStore } from "./layout-store";
import {
  LayoutsStore,
  copyName,
  layoutView,
  migrateLayouts,
  nextLayoutId,
  nextLayoutName,
  parseCars,
  parseLayoutsFile,
  parseMatch,
  patchMatch,
  type StoredLayout,
} from "./layouts-store";
import { OverlaySettingsStore } from "./overlay-settings-store";

const bounds = (x: number): Layout => ({
  relative: { x, y: 10, width: 400, height: 300, scalePct: 100 },
});

let dir: string;
let settings: OverlaySettingsStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-layouts-"));
  settings = new OverlaySettingsStore(join(dir, "overlay-settings.json"), OVERLAY_MANIFESTS);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fallback = (): StoredLayout => {
  const first = migrateLayouts(bounds(5), {}).layouts[0];
  if (!first) throw new Error("no default");
  return first;
};

function makeStore(legacy: Layout = bounds(100)) {
  const legacyFile = join(dir, "layout.json");
  const legacyStore = new LayoutStore(legacyFile);
  legacyStore.save(legacy);
  const store = new LayoutsStore({
    file: join(dir, "layouts.json"),
    manifests: OVERLAY_MANIFESTS,
    loadLegacyBounds: () => legacyStore.load(OVERLAY_MANIFESTS),
    saveLegacyBounds: (b) => legacyStore.save(b),
    currentSettings: () => settings.getAll(),
  });
  return { store, legacyFile };
}

const readLayouts = (): unknown => JSON.parse(readFileSync(join(dir, "layouts.json"), "utf8"));

describe("migrateLayouts", () => {
  it("turns the old bounds and the current on/off states into the active Default layout", () => {
    const all: Record<string, OverlayInstanceSettings> = settings.getAll();
    const file = migrateLayouts(bounds(42), all);
    expect(file.activeId).toBe(DEFAULT_LAYOUT_ID);
    expect(file.autoSwitch).toBe(true);
    expect(file.layouts).toHaveLength(1);
    const def = file.layouts[0];
    expect(def?.id).toBe(DEFAULT_LAYOUT_ID);
    expect(def?.name).toBe("Default");
    expect(def?.match).toEqual({ sims: [], cars: [], sessions: [] });
    expect(def?.bounds).toEqual(bounds(42));
    expect(def?.enabled["relative"]).toBe(all["relative"]?.enabled);
    expect(Object.keys(def?.enabled ?? {})).toEqual(Object.keys(all));
  });
});

describe("parseMatch / patchMatch", () => {
  it("keeps known sims and sessions in canonical order and cleans car names", () => {
    expect(
      parseMatch({
        sims: ["lmu", "bogus", "iracing", "lmu"],
        sessions: ["race", "qualifying", 3, "other"],
        cars: [" Ferrari 296 GT3 ", "ferrari 296 gt3", "", 7, "BMW M4 GT3"],
      }),
    ).toEqual({
      sims: ["iracing", "lmu"],
      sessions: ["qualifying", "race", "other"],
      cars: ["Ferrari 296 GT3", "BMW M4 GT3"],
    });
    expect(parseMatch(null)).toEqual({ sims: [], cars: [], sessions: [] });
    expect(parseCars(Array.from({ length: 80 }, (_, i) => `Car ${i}`))).toHaveLength(50);
  });

  it("replaces only the lists present in a patch", () => {
    const current = { sims: ["iracing" as const], cars: ["A"], sessions: ["race" as const] };
    expect(patchMatch(current, { cars: ["B"] })).toEqual({ ...current, cars: ["B"] });
    expect(patchMatch(current, { sims: [] })).toEqual({ ...current, sims: [] });
    expect(patchMatch(current, "nope")).toBe(current);
  });
});

describe("parseLayoutsFile", () => {
  it("returns undefined for a missing or shapeless file (the caller migrates)", () => {
    expect(parseLayoutsFile(undefined, OVERLAY_MANIFESTS, fallback)).toBeUndefined();
    expect(parseLayoutsFile({ layouts: "x" }, OVERLAY_MANIFESTS, fallback)).toBeUndefined();
  });

  it("drops invalid layouts, duplicate ids and unknown instances; Default goes first", () => {
    const parsed = parseLayoutsFile(
      {
        version: 1,
        activeId: "layout-1",
        autoSwitch: false,
        layouts: [
          {
            id: "layout-1",
            name: "  Endurance  ",
            match: { sessions: ["race"] },
            enabled: { relative: true, "no-such-overlay": true, inputs: "yes" },
            bounds: { relative: { x: 1, y: 2, width: 300, height: 200 }, bogus: { x: 1 } },
          },
          { id: "layout-1", name: "Dupe" },
          { name: "No id" },
          "junk",
          { id: "default", name: "Renamed", match: { sims: ["lmu"] }, enabled: {}, bounds: {} },
        ],
      },
      OVERLAY_MANIFESTS,
      fallback,
    );
    expect(parsed?.autoSwitch).toBe(false);
    expect(parsed?.activeId).toBe("layout-1");
    expect(parsed?.layouts.map((l) => l.id)).toEqual(["default", "layout-1"]);
    const [def, endurance] = parsed?.layouts ?? [];
    // Default keeps its name and carries no tags.
    expect(def?.name).toBe("Default");
    expect(def?.match.sims).toEqual([]);
    expect(endurance?.name).toBe("Endurance");
    expect(endurance?.match.sessions).toEqual(["race"]);
    expect(endurance?.enabled).toEqual({ relative: true });
    expect(endurance?.bounds).toEqual({
      relative: { x: 1, y: 2, width: 300, height: 200, scalePct: 100 },
    });
  });

  it("rebuilds a missing Default and falls back to it for an unknown active id", () => {
    const parsed = parseLayoutsFile(
      { activeId: "gone", layouts: [{ id: "layout-3", name: "Mine" }] },
      OVERLAY_MANIFESTS,
      fallback,
    );
    expect(parsed?.layouts.map((l) => l.id)).toEqual(["default", "layout-3"]);
    expect(parsed?.layouts[0]?.bounds).toEqual(bounds(5));
    expect(parsed?.activeId).toBe("default");
    expect(parsed?.autoSwitch).toBe(true);
  });
});

describe("naming helpers", () => {
  it("finds free ids and names", () => {
    expect(nextLayoutId(["default"])).toBe("layout-1");
    expect(nextLayoutId(["layout-1", "layout-3"])).toBe("layout-2");
    expect(nextLayoutName(["Default"])).toBe("Layout 2");
    expect(nextLayoutName(["Default", "layout 2"])).toBe("Layout 3");
    expect(copyName("Race")).toBe("Race copy");
    expect(copyName("x".repeat(40))).toHaveLength(40);
  });

  it("counts the overlays a layout turns on", () => {
    const view = layoutView({
      id: "layout-1",
      name: "A",
      match: { sims: [], cars: [], sessions: [] },
      enabled: { relative: true, inputs: false, fuel: true },
      bounds: {},
    });
    expect(view.overlayCount).toBe(2);
    expect(view.isDefault).toBe(false);
  });
});

describe("LayoutsStore", () => {
  it("migrates layout.json on first run, writes layouts.json and leaves layout.json readable", () => {
    const { store, legacyFile } = makeStore(bounds(77));
    expect(store.activeId).toBe("default");
    expect(store.active().bounds).toEqual(bounds(77));
    expect(readLayouts()).toMatchObject({ version: 1, activeId: "default", autoSwitch: true });
    expect(JSON.parse(readFileSync(legacyFile, "utf8"))).toEqual(bounds(77));
  });

  it("reads back what it wrote", () => {
    const { store } = makeStore();
    const id = store.createFromActive();
    expect(id).toBe("layout-1");
    store.setMatch("layout-1", { sims: ["lmu"], cars: ["BMW M4 GT3"] });
    store.setActive("layout-1");
    store.saveActiveBounds(bounds(300));
    store.setAutoSwitch(false);
    const again = makeStore(bounds(1)).store;
    expect(again.activeId).toBe("layout-1");
    expect(again.autoSwitch).toBe(false);
    expect(again.get("layout-1")?.match).toEqual({
      sims: ["lmu"],
      cars: ["BMW M4 GT3"],
      sessions: [],
    });
    expect(again.get("layout-1")?.bounds).toEqual(bounds(300));
    expect(again.get("default")?.bounds).toEqual(bounds(100));
  });

  it("migrates again when layouts.json cannot be parsed (and keeps the bad file aside)", () => {
    writeFileSync(join(dir, "layouts.json"), "{ not json", "utf8");
    const { store } = makeStore(bounds(9));
    expect(store.list()).toHaveLength(1);
    expect(store.active().bounds).toEqual(bounds(9));
  });

  it("mirrors the active layout's bounds into layout.json", () => {
    const { store, legacyFile } = makeStore();
    store.saveActiveBounds(bounds(555));
    expect(JSON.parse(readFileSync(legacyFile, "utf8"))).toEqual(bounds(555));
  });

  it("creates, duplicates, renames and deletes layouts; Default cannot be renamed or deleted", () => {
    const { store } = makeStore();
    const created = store.createFromActive();
    expect(store.get(created ?? "")?.name).toBe("Layout 2");
    store.setMatch(created ?? "", { sessions: ["race"] });
    const copy = store.duplicate(created ?? "");
    expect(store.get(copy ?? "")?.name).toBe("Layout 2 copy");
    expect(store.get(copy ?? "")?.match.sessions).toEqual(["race"]);
    expect(store.rename(copy ?? "", "  Sprint ")).toBe(true);
    expect(store.get(copy ?? "")?.name).toBe("Sprint");
    expect(store.rename(copy ?? "", "   ")).toBe(false);
    expect(store.rename("default", "Mine")).toBe(false);
    expect(store.remove("default")).toBe(false);
    expect(store.setMatch("default", { sims: ["lmu"] })).toBe(false);
    expect(store.remove(copy ?? "")).toBe(true);
    expect(store.list().map((l) => l.id)).toEqual(["default", created]);
  });

  it("copies the active layout without its tags for New layout", () => {
    const { store } = makeStore();
    const first = store.createFromActive() ?? "";
    store.setMatch(first, { sims: ["iracing"] });
    store.setActive(first);
    const second = store.createFromActive() ?? "";
    expect(store.get(second)?.match.sims).toEqual([]);
    expect(store.get(second)?.bounds).toEqual(store.get(first)?.bounds);
  });

  it("will not delete the active layout (the switcher moves to Default first)", () => {
    const { store } = makeStore();
    const id = store.createFromActive() ?? "";
    store.setActive(id);
    expect(store.remove(id)).toBe(false);
  });

  it("records on/off states in the active layout and forgets removed instances everywhere", () => {
    const { store } = makeStore();
    const id = store.duplicate("default") ?? "";
    store.setEnabled("relative:2", true);
    store.saveActiveBounds({
      ...bounds(1),
      "relative:2": { x: 0, y: 0, width: 100, height: 100, scalePct: 100 },
    });
    store.setActive(id);
    store.setEnabled("relative:2", false);
    store.forgetInstance("relative:2");
    expect("relative:2" in (store.get("default")?.enabled ?? {})).toBe(false);
    expect("relative:2" in (store.get("default")?.bounds ?? {})).toBe(false);
    expect("relative:2" in (store.get(id)?.enabled ?? {})).toBe(false);
  });

  it("tells listeners about changes", () => {
    const { store } = makeStore();
    let calls = 0;
    store.onChange(() => (calls += 1));
    store.setAutoSwitch(false);
    store.setAutoSwitch(false);
    store.createFromActive();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
