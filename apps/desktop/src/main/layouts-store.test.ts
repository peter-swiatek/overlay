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
  const first = migrateLayouts(bounds(5), {}, OVERLAY_MANIFESTS).layouts[0];
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
  it("makes the old bounds and on/off states the active fallback group, plus one group per game", () => {
    settings.update("compact-hud", { enabled: true });
    settings.update("car-status", { enabled: true });
    const all: Record<string, OverlayInstanceSettings> = settings.getAll();
    const file = migrateLayouts(bounds(42), all, OVERLAY_MANIFESTS);
    expect(file.version).toBe(2);
    expect(file.activeId).toBe(DEFAULT_LAYOUT_ID);
    expect(file.autoSwitch).toBe(true);
    expect(file.layouts.map((l) => [l.id, l.name, l.match.game])).toEqual([
      ["default", "Everything else", null],
      ["layout-1", "iRacing", "iracing"],
      ["layout-2", "Le Mans Ultimate", "lmu"],
    ]);
    const [def, iracing, lmu] = file.layouts;
    expect(def?.match).toEqual({ game: null, sessions: [], carTypes: [], cars: [] });
    expect(def?.bounds).toEqual(bounds(42));
    expect(def?.enabled["relative"]).toBe(all["relative"]?.enabled);
    expect(Object.keys(def?.enabled ?? {})).toEqual(Object.keys(all));
    // Each starter copies the positions and keeps only what its game offers on.
    expect(iracing?.bounds).toEqual(bounds(42));
    expect(iracing?.enabled["compact-hud"]).toBe(true);
    expect(iracing?.enabled["car-status"]).toBe(false);
    expect(lmu?.enabled["compact-hud"]).toBe(false);
    expect(lmu?.enabled["car-status"]).toBe(true);
    expect(lmu?.enabled["relative"]).toBe(all["relative"]?.enabled);
  });
});

describe("parseMatch / patchMatch", () => {
  it("keeps known values in canonical order and cleans car names", () => {
    expect(
      parseMatch({
        game: "iracing",
        sessions: ["race", "qualifying", 3, "other"],
        carTypes: ["oval", "formula", "kart"],
        cars: [" Ferrari 296 GT3 ", "ferrari 296 gt3", "", 7, "BMW M4 GT3"],
      }),
    ).toEqual({
      game: "iracing",
      sessions: ["qualifying", "race", "other"],
      carTypes: ["formula", "oval"],
      cars: ["Ferrari 296 GT3", "BMW M4 GT3"],
    });
    expect(parseMatch(null)).toEqual({ game: null, sessions: [], carTypes: [], cars: [] });
    expect(parseMatch({ game: "rf2" }).game).toBeNull();
    expect(parseCars(Array.from({ length: 80 }, (_, i) => `Car ${i}`))).toHaveLength(50);
  });

  it("reads the version 1 sims list as a game", () => {
    expect(parseMatch({ sims: ["lmu"] }).game).toBe("lmu");
    expect(parseMatch({ sims: ["iracing", "lmu"] }).game).toBeNull();
    expect(parseMatch({ sims: [] }).game).toBeNull();
  });

  it("drops car types from a Le Mans Ultimate group", () => {
    expect(parseMatch({ game: "lmu", carTypes: ["formula"] }).carTypes).toEqual([]);
    const current = parseMatch({ game: "iracing", carTypes: ["formula"] });
    expect(patchMatch(current, { game: "lmu" })).toMatchObject({ game: "lmu", carTypes: [] });
  });

  it("replaces only the conditions present in a patch", () => {
    const current = parseMatch({ game: "iracing", cars: ["A"], sessions: ["race"] });
    expect(patchMatch(current, { cars: ["B"] })).toEqual({ ...current, cars: ["B"] });
    expect(patchMatch(current, { game: null })).toEqual({ ...current, game: null });
    expect(patchMatch(current, { carTypes: ["dirt"] })).toEqual({ ...current, carTypes: ["dirt"] });
    expect(patchMatch(current, "nope")).toBe(current);
  });
});

describe("parseLayoutsFile", () => {
  it("returns undefined for a missing or shapeless file (the caller migrates)", () => {
    expect(parseLayoutsFile(undefined, OVERLAY_MANIFESTS, fallback)).toBeUndefined();
    expect(parseLayoutsFile({ layouts: "x" }, OVERLAY_MANIFESTS, fallback)).toBeUndefined();
  });

  it("drops invalid groups, duplicate ids and unknown instances; the fallback goes first", () => {
    const parsed = parseLayoutsFile(
      {
        version: 2,
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
          { id: "default", name: "Renamed", match: { game: "lmu" }, enabled: {}, bounds: {} },
        ],
      },
      OVERLAY_MANIFESTS,
      fallback,
    );
    expect(parsed?.autoSwitch).toBe(false);
    expect(parsed?.activeId).toBe("layout-1");
    expect(parsed?.layouts.map((l) => l.id)).toEqual(["default", "layout-1"]);
    const [def, endurance] = parsed?.layouts ?? [];
    expect(def?.name).toBe("Everything else");
    expect(def?.match.game).toBeNull();
    expect(endurance?.name).toBe("Endurance");
    expect(endurance?.match.sessions).toEqual(["race"]);
    expect(endurance?.enabled).toEqual({ relative: true });
    expect(endurance?.bounds).toEqual({
      relative: { x: 1, y: 2, width: 300, height: 200, scalePct: 100 },
    });
  });

  it("adds the starter groups to a version 1 file that holds only the fallback", () => {
    const v1 = { version: 1, activeId: "default", layouts: [{ id: "default", name: "Default" }] };
    const parsed = parseLayoutsFile(v1, OVERLAY_MANIFESTS, fallback);
    expect(parsed?.layouts.map((l) => l.name)).toEqual([
      "Everything else",
      "iRacing",
      "Le Mans Ultimate",
    ]);
    // Not to a version 1 file with groups of the user's own, nor to a version 2 file.
    const own = { ...v1, layouts: [...v1.layouts, { id: "layout-1", name: "Mine" }] };
    expect(parseLayoutsFile(own, OVERLAY_MANIFESTS, fallback)?.layouts).toHaveLength(2);
    const v2 = { ...v1, version: 2 };
    expect(parseLayoutsFile(v2, OVERLAY_MANIFESTS, fallback)?.layouts).toHaveLength(1);
  });

  it("rebuilds a missing fallback and falls back to it for an unknown active id", () => {
    const parsed = parseLayoutsFile(
      { version: 2, activeId: "gone", layouts: [{ id: "layout-3", name: "Mine" }] },
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
    expect(nextLayoutName(["Everything else"])).toBe("Group 1");
    expect(nextLayoutName(["Everything else", "group 1"])).toBe("Group 2");
    expect(copyName("Race")).toBe("Race copy");
    expect(copyName("x".repeat(40))).toHaveLength(40);
  });

  it("lists a group with its on/off states", () => {
    const view = layoutView({
      id: "layout-1",
      name: "A",
      match: { game: null, sessions: [], carTypes: [], cars: [] },
      enabled: { relative: true, inputs: false },
      bounds: {},
    });
    expect(view.enabled).toEqual({ relative: true, inputs: false });
    expect(view.isDefault).toBe(false);
  });
});

describe("LayoutsStore", () => {
  it("migrates layout.json on first run, writes layouts.json and leaves layout.json readable", () => {
    const { store, legacyFile } = makeStore(bounds(77));
    expect(store.activeId).toBe("default");
    expect(store.active().bounds).toEqual(bounds(77));
    expect(store.list().map((l) => l.name)).toEqual([
      "Everything else",
      "iRacing",
      "Le Mans Ultimate",
    ]);
    expect(readLayouts()).toMatchObject({ version: 2, activeId: "default", autoSwitch: true });
    expect(JSON.parse(readFileSync(legacyFile, "utf8"))).toEqual(bounds(77));
  });

  it("upgrades a version 1 file on disk once", () => {
    writeFileSync(
      join(dir, "layouts.json"),
      JSON.stringify({
        version: 1,
        activeId: "default",
        autoSwitch: true,
        layouts: [{ id: "default", name: "Default", match: {}, enabled: {}, bounds: bounds(3) }],
      }),
      "utf8",
    );
    const { store } = makeStore();
    expect(store.list()).toHaveLength(3);
    expect(store.get("layout-1")?.bounds).toEqual(bounds(3));
    expect(readLayouts()).toMatchObject({ version: 2 });
    store.remove("layout-1");
    expect(makeStore().store.list()).toHaveLength(2);
  });

  it("reads back what it wrote", () => {
    const { store } = makeStore();
    const id = store.createFromActive() ?? "";
    expect(id).toBe("layout-3");
    store.setMatch(id, { game: "iracing", carTypes: ["formula"], cars: ["Dallara F3"] });
    store.setActive(id);
    store.saveActiveBounds(bounds(300));
    store.setAutoSwitch(false);
    const again = makeStore(bounds(1)).store;
    expect(again.activeId).toBe(id);
    expect(again.autoSwitch).toBe(false);
    expect(again.get(id)?.match).toEqual({
      game: "iracing",
      sessions: [],
      carTypes: ["formula"],
      cars: ["Dallara F3"],
    });
    expect(again.get(id)?.bounds).toEqual(bounds(300));
    expect(again.get("default")?.bounds).toEqual(bounds(100));
  });

  it("migrates again when layouts.json cannot be parsed (and keeps the bad file aside)", () => {
    writeFileSync(join(dir, "layouts.json"), "{ not json", "utf8");
    const { store } = makeStore(bounds(9));
    expect(store.list()).toHaveLength(3);
    expect(store.active().bounds).toEqual(bounds(9));
  });

  it("mirrors the active group's bounds into layout.json", () => {
    const { store, legacyFile } = makeStore();
    store.saveActiveBounds(bounds(555));
    expect(JSON.parse(readFileSync(legacyFile, "utf8"))).toEqual(bounds(555));
  });

  it("lists the fallback group last", () => {
    const { store } = makeStore();
    expect(store.views().map((v) => v.id)).toEqual(["layout-1", "layout-2", "default"]);
  });

  it("creates, duplicates, renames and deletes groups; the fallback cannot be renamed or deleted", () => {
    const { store } = makeStore();
    const created = store.createFromActive() ?? "";
    expect(store.get(created)?.name).toBe("Group 1");
    store.setMatch(created, { sessions: ["race"] });
    const copy = store.duplicate(created) ?? "";
    expect(store.get(copy)?.name).toBe("Group 1 copy");
    expect(store.get(copy)?.match.sessions).toEqual(["race"]);
    expect(store.rename(copy, "  Sprint ")).toBe(true);
    expect(store.get(copy)?.name).toBe("Sprint");
    expect(store.rename(copy, "   ")).toBe(false);
    expect(store.rename("default", "Mine")).toBe(false);
    expect(store.remove("default")).toBe(false);
    expect(store.setMatch("default", { game: "lmu" })).toBe(false);
    expect(store.remove(copy)).toBe(true);
    expect(store.list().map((l) => l.id)).toEqual(["default", "layout-1", "layout-2", created]);
  });

  it("copies the active group without its conditions for New group", () => {
    const { store } = makeStore();
    store.setActive("layout-1");
    const second = store.createFromActive() ?? "";
    expect(store.get(second)?.match.game).toBeNull();
    expect(store.get(second)?.enabled).toEqual(store.get("layout-1")?.enabled);
  });

  it("will not delete the active group (the switcher moves to the fallback first)", () => {
    const { store } = makeStore();
    store.setActive("layout-1");
    expect(store.remove("layout-1")).toBe(false);
  });

  it("turns overlays on or off per group, honouring the group's game", () => {
    const { store } = makeStore();
    expect(store.setEnabledIn("layout-2", "car-status", true)).toBe(true);
    expect(store.isOn("layout-2", "car-status")).toBe(true);
    expect(store.isOn("default", "car-status")).toBe(false);
    // An iRacing-only overlay is never on in a Le Mans Ultimate group.
    store.setEnabledIn("layout-2", "compact-hud", true);
    expect(store.isOn("layout-2", "compact-hud")).toBe(false);
    expect(store.setEnabledIn("layout-2", "no-such-overlay", true)).toBe(false);
  });

  it("records on/off states in the active group and forgets removed instances everywhere", () => {
    const { store } = makeStore();
    store.setEnabled("data-frames:2", true);
    store.saveActiveBounds({
      ...bounds(1),
      "data-frames:2": { x: 0, y: 0, width: 100, height: 100, scalePct: 100 },
    });
    store.setActive("layout-1");
    store.setEnabled("data-frames:2", false);
    expect(store.get("default")?.enabled["data-frames:2"]).toBe(true);
    store.forgetInstance("data-frames:2");
    expect("data-frames:2" in (store.get("default")?.enabled ?? {})).toBe(false);
    expect("data-frames:2" in (store.get("default")?.bounds ?? {})).toBe(false);
    expect("data-frames:2" in (store.get("layout-1")?.enabled ?? {})).toBe(false);
  });

  it("does not overwrite an overlay the active group's game hides when capturing states", () => {
    const { store } = makeStore();
    store.setActive("layout-2");
    store.setEnabledIn("layout-2", "compact-hud", true);
    store.captureEnabled(settings.getAll());
    expect(store.get("layout-2")?.enabled["compact-hud"]).toBe(true);
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
