import type { OverlayManifest, SettingField } from "@overlay/overlays/contract";
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
  listOverlays,
  moveField,
  movePick,
  panelSections,
  removePick,
  setFieldPatch,
  simBadge,
  simFromSource,
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

  it("splits by enabled in manifest order and hides dev overlays unless developer is on", () => {
    expect(listOverlays([a, b, d], {}, false)).toEqual({ active: [a], available: [b] });
    expect(listOverlays([a, b, d], {}, true)).toEqual({ active: [a, d], available: [b] });
  });

  it("uses stored settings over defaults", () => {
    const all = { a: { ...defaultInstanceSettings(a), enabled: false } };
    expect(listOverlays([a, b], all, false).available).toEqual([a, b]);
  });
});

describe("panelSections", () => {
  it("orders sections by first appearance and puts unsectioned fields last under Options", () => {
    const titles = panelSections(testManifest).map((s) => s.title);
    expect(titles).toEqual(["Layout", "Colours", "Options"]);
    expect(panelSections(testManifest)[0]?.fields.map((f) => f.key)).toEqual(["size", "mode"]);
  });
});

describe("sims", () => {
  it("badges and availability", () => {
    expect(simBadge(["iracing"])).toBe("iRacing only");
    expect(simBadge(["lmu"])).toBe("LMU only");
    expect(simBadge(["iracing", "lmu"])).toBe("iRacing / LMU only");
    expect(isAvailableIn(undefined, "lmu")).toBe(true);
    expect(isAvailableIn(["lmu"], "iracing")).toBe(false);
  });

  it("defaults the filter from the telemetry source", () => {
    expect(simFromSource("lmu")).toBe("lmu");
    for (const s of ["iracing", "replay", "mock", null]) expect(simFromSource(s)).toBe("iracing");
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
