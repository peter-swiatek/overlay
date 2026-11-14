import type { OverlayManifest, SettingField } from "@overlay/overlays/contract";
import { instanceId, MAX_INSTANCES } from "@overlay/overlays/instances";
import {
  applySettingsPatch,
  defaultInstanceSettings,
  mergeFieldConfig,
} from "@overlay/overlays/settings";
import { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from "@overlay/ui/types";
import { describe, expect, it } from "vitest";
import { createDebouncer, type TimerApi } from "./debounce";
import {
  addPick,
  fromDisplay,
  isAvailableIn,
  isSegmentedSelect,
  canAddInstance,
  listOverlays,
  overlayEntries,
  settingsOf,
  moveField,
  movePick,
  multiFields,
  panelSections,
  pickCounter,
  removePick,
  reorderPick,
  setFieldPatch,
  simBadge,
  simForGame,
  toDisplay,
} from "./model";
import { testManifest } from "./test-manifest";

const metric = DEFAULT_DISPLAY_PREFS;
const imperial: DisplayPrefs = { ...DEFAULT_DISPLAY_PREFS, units: "imperial" };
const mph: DisplayPrefs = { ...DEFAULT_DISPLAY_PREFS, speedInMph: true };

describe("listOverlays", () => {
  const a: OverlayManifest = { ...testManifest, id: "a", defaultEnabled: true };
  const b: OverlayManifest = { ...testManifest, id: "b", defaultEnabled: false };
  const d: OverlayManifest = { ...testManifest, id: "d", defaultEnabled: true, dev: true };

  const ids = (list: { id: string }[]) => list.map((e) => e.id);

  it("splits by enabled in manifest order and hides dev overlays unless developer is on", () => {
    const off = listOverlays([a, b, d], {}, false);
    expect(ids(off.active)).toEqual(["a"]);
    expect(ids(off.available)).toEqual(["b"]);
    expect(off.active[0]).toMatchObject({ manifest: a, title: a.title, added: false });
    const on = listOverlays([a, b, d], {}, true);
    expect(ids(on.active)).toEqual(["a", "d"]);
    expect(ids(on.available)).toEqual(["b"]);
  });

  it("uses stored settings over defaults", () => {
    const all = { a: { ...defaultInstanceSettings(a), enabled: false } };
    expect(ids(listOverlays([a, b], all, false).available)).toEqual(["a", "b"]);
  });

  it("lists added instances after their overlay, each in its own group, with their titles", () => {
    const on = { ...defaultInstanceSettings(a), enabled: true };
    const all = {
      "a:3": { ...on, name: "Behind" },
      "b:2": on,
      "a:2": { ...on, enabled: false },
      "a:x": on,
      "zz:2": on,
    };
    const { active, available } = listOverlays([a, b], all, false);
    expect(ids(active)).toEqual(["a", "a:3", "b:2"]);
    expect(ids(available)).toEqual(["a:2", "b"]);
    expect(active.map((e) => e.title)).toEqual([a.title, "Behind", `${b.title} 2`]);
    expect(active.map((e) => e.added)).toEqual([false, true, true]);
    expect(overlayEntries([a, b], all, false).map((e) => e.id)).toEqual([
      "a",
      "a:2",
      "a:3",
      "b",
      "b:2",
    ]);
  });

  it("allows adding instances until the overlay has the most", () => {
    const all: Record<string, ReturnType<typeof defaultInstanceSettings>> = {};
    for (let n = 1; n < MAX_INSTANCES; n++) all[instanceId("a", n)] = defaultInstanceSettings(a);
    expect(canAddInstance(a, all)).toBe(true);
    all[instanceId("a", MAX_INSTANCES)] = defaultInstanceSettings(a);
    expect(canAddInstance(a, all)).toBe(false);
    expect(canAddInstance(b, all)).toBe(true);
  });

  it("reads an instance's own settings", () => {
    const all = { "a:2": { ...defaultInstanceSettings(a), enabled: false } };
    expect(settingsOf(a, all, "a:2").enabled).toBe(false);
    expect(settingsOf(a, all, "a:4")).toEqual(defaultInstanceSettings(a));
  });
});

describe("panelSections", () => {
  it("orders sections by first appearance and puts unsectioned fields last under Options", () => {
    const titles = panelSections(testManifest).map((s) => s.title);
    expect(titles).toEqual(["Layout", "Colours", "Options"]);
    expect(panelSections(testManifest)[0]?.fields.map((f) => f.key)).toEqual(["size", "mode"]);
  });

  it("leaves multi settings to the Header and footer section", () => {
    expect(multiFields(testManifest).map((f) => f.key)).toEqual(["extras"]);
    const keys = panelSections(testManifest).flatMap((s) => s.fields.map((f) => f.key));
    expect(keys).not.toContain("extras");
  });
});

describe("sims", () => {
  it("badges and availability", () => {
    expect(simBadge(["iracing"])).toBe("iRacing only");
    expect(simBadge(["lmu"])).toBe("LMU only");
    expect(simBadge(["iracing", "lmu"])).toBe("iRacing / LMU only");
    expect(isAvailableIn(undefined, "lmu")).toBe(true);
    expect(isAvailableIn(["lmu"], "iracing")).toBe(false);
    expect(isAvailableIn(["lmu"], null)).toBe(true);
  });

  it("follows the picked game, else the connected sim, else nothing", () => {
    const live = (source: "iracing" | "lmu" | "mock" | "replay" | null) =>
      ({ status: "live", source }) as const;
    expect(simForGame("lmu", live("iracing"))).toBe("lmu");
    expect(simForGame("iracing", null)).toBe("iracing");
    expect(simForGame("auto", live("lmu"))).toBe("lmu");
    expect(simForGame("auto", live("iracing"))).toBe("iracing");
    expect(simForGame("auto", null)).toBeNull();
    expect(simForGame("auto", { status: "waiting", source: "lmu" })).toBeNull();
    expect(simForGame("auto", live("mock"))).toBeNull();
    expect(simForGame("mock", live("mock"))).toBeNull();
    expect(simForGame("replay", live("replay"))).toBeNull();
  });
});

describe("pickers and segmented selects", () => {
  it("counts picks", () => {
    expect(pickCounter(3, 5)).toBe("3 of 5");
    expect(pickCounter(2)).toBe("2 picked");
  });

  it("reorders by drag and keeps the maximum", () => {
    expect(reorderPick(["a", "b", "c"], 0, 2, 3)).toEqual(["b", "c", "a"]);
    expect(reorderPick(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorderPick(["a", "b", "c"], 0, 2, 3)).toHaveLength(3);
    expect(reorderPick(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  it("uses a segmented control for up to three plain options", () => {
    const select = (options: { value: string; label: string; sims?: ["lmu"] }[]) =>
      ({ key: "k", label: "K", kind: "select", default: "a", options }) as const;
    const o = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `V${i}` }));
    expect(isSegmentedSelect(select(o(2)))).toBe(true);
    expect(isSegmentedSelect(select(o(3)))).toBe(true);
    expect(isSegmentedSelect(select(o(4)))).toBe(false);
    expect(isSegmentedSelect(select([{ value: "a", label: "A", sims: ["lmu"] }]))).toBe(false);
  });
});

describe("unit conversion", () => {
  const dist: Extract<SettingField, { kind: "number" }> = {
    key: "d",
    label: "Distance",
    kind: "number",
    default: 50,
    min: 0,
    max: 200,
    step: 5,
    unit: "m",
  };
  const speed: Extract<SettingField, { kind: "number" }> = {
    ...dist,
    key: "v",
    default: 10,
    max: 100,
    step: 1,
    unit: "km/h",
  };

  it("shows metres as stored and converts to feet when imperial", () => {
    expect(toDisplay("m", 50, metric, 5)).toBe(50);
    expect(toDisplay("m", 50, imperial, 5)).toBe(164);
    expect(fromDisplay("m", 164, imperial, dist, 50)).toBe(50);
  });

  it("converts km/h to mph for imperial units and for speedInMph only", () => {
    expect(toDisplay("km/h", 100, metric, 1)).toBe(100);
    expect(toDisplay("km/h", 100, imperial, 1)).toBe(62.1);
    expect(toDisplay("km/h", 100, mph, 1)).toBe(62.1);
    expect(toDisplay("m", 100, mph, 5)).toBe(100);
    expect(fromDisplay("km/h", 62.1, mph, { ...speed, default: 100, max: 200 }, 100)).toBe(100);
  });

  it("round-trips every stored step in each preference set", () => {
    for (const prefs of [metric, imperial, mph]) {
      for (let v = 0; v <= 200; v += 5) {
        expect(fromDisplay("m", toDisplay("m", v, prefs, 5), prefs, dist, v)).toBe(v);
      }
    }
  });

  it("always moves one stored step when the shown value moved but the snap did not", () => {
    // 1 mph is 1.6 km/h; with a 5 km/h step, 31 mph -> 49.9 km/h snaps back to 50 (current).
    const coarse = { ...speed, default: 50, max: 200, step: 5 };
    const now = toDisplay("km/h", 50, imperial, 5);
    expect(now).toBe(31);
    expect(fromDisplay("km/h", now + 1, imperial, coarse, 50)).toBe(55);
    expect(fromDisplay("km/h", now - 1, imperial, coarse, 50)).toBe(45);
    expect(fromDisplay("km/h", now, imperial, coarse, 50)).toBe(50);
  });

  it("leaves other units alone", () => {
    expect(toDisplay("px", 12, imperial, 1)).toBe(12);
  });
});

describe("multi picks", () => {
  it("never exceeds max and never duplicates", () => {
    expect(addPick(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(addPick(["a", "b"], "c", 2)).toEqual(["a", "b"]);
    expect(addPick(["a"], "a")).toEqual(["a"]);
    expect(removePick(["a", "b"], "a")).toEqual(["b"]);
  });

  it("moves and stops at the ends", () => {
    expect(movePick(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(movePick(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(movePick(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(movePick(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("column lists", () => {
  const settings = defaultInstanceSettings(testManifest);
  const fields = settings.common.fields;

  it("moveField and setFieldPatch keep every field exactly once", () => {
    const moved = moveField(fields, 0, 3);
    expect(moved.map((f) => f.id)).toEqual(["b", "c", "d", "a"]);
    expect(mergeFieldConfig(testManifest, moved)).toEqual(moved);
    const edited = setFieldPatch(moved, "c", { visible: false, widthPct: 30 });
    expect(mergeFieldConfig(testManifest, edited)).toEqual(edited);
    expect(edited.find((f) => f.id === "c")).toEqual({ id: "c", visible: false, widthPct: 30 });
  });

  it("ignores moves out of range", () => {
    expect(moveField(fields, 0, 9)).toEqual(fields);
    expect(moveField(fields, -1, 0)).toEqual(fields);
  });

  it("applySettingsPatch reorders through the same code as main", () => {
    const next = applySettingsPatch(testManifest, settings, {
      common: { fields: moveField(fields, 3, 0) },
    });
    expect(next.common.fields.map((f) => f.id)).toEqual(["d", "a", "b", "c"]);
  });
});

describe("createDebouncer", () => {
  function fakeTimer() {
    const timers = new Map<number, () => void>();
    let next = 1;
    const api: TimerApi<number> = {
      set: (fn) => {
        timers.set(next, fn);
        return next++;
      },
      clear: (h) => void timers.delete(h),
    };
    return { api, timers, fire: () => [...timers.values()].forEach((f) => f()) };
  }

  it("lets the last value per key win", () => {
    const t = fakeTimer();
    const sent: number[] = [];
    const d = createDebouncer(t.api);
    d.schedule("k", () => sent.push(1));
    d.schedule("k", () => sent.push(2));
    d.schedule("other", () => sent.push(9));
    t.fire();
    expect(sent).toEqual([2, 9]);
  });

  it("flush runs pending calls once and cancels their timers", () => {
    const t = fakeTimer();
    const sent: number[] = [];
    const d = createDebouncer(t.api);
    d.schedule("k", () => sent.push(1));
    d.flush();
    d.flush();
    t.fire();
    expect(sent).toEqual([1]);
    expect(t.timers.size).toBe(0);
  });
});
