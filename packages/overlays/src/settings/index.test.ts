import { describe, expect, it } from "vitest";
import type { OverlayInstanceSettings, OverlayManifest } from "../contract";
import {
  applySettingsPatch,
  defaultInstanceSettings,
  mergeFieldConfig,
  optionBoolean,
  optionNumber,
  optionString,
  optionStrings,
  parseOverlaySettingsFile,
  sanitizeInstanceSettings,
  sanitizeOptionValue,
  visibleFields,
} from "./index";

const manifest: OverlayManifest = {
  id: "test",
  title: "Test",
  description: "",
  sims: ["iracing"],
  defaultSize: { width: 100, height: 100 },
  minSize: { width: 50, height: 50 },
  defaultPosition: { x: 0, y: 0 },
  table: true,
  fields: [
    { id: "a", label: "A", defaultVisible: true },
    { id: "b", label: "B", defaultVisible: false },
    { id: "c", label: "C", defaultVisible: true },
    { id: "d", label: "D", defaultVisible: true },
  ],
  settings: [
    { key: "flag", label: "Flag", kind: "toggle", default: true },
    { key: "num", label: "Num", kind: "number", default: 10, min: 0, max: 20, step: 5 },
    { key: "frac", label: "Frac", kind: "number", default: 0.5, min: 0, max: 1, step: 0.1 },
    {
      key: "pick",
      label: "Pick",
      kind: "select",
      default: "x",
      options: [
        { value: "x", label: "X" },
        { value: "y", label: "Y" },
      ],
    },
    {
      key: "many",
      label: "Many",
      kind: "multi",
      default: ["x"],
      max: 2,
      options: [
        { value: "x", label: "X" },
        { value: "y", label: "Y" },
        { value: "z", label: "Z" },
      ],
    },
    { key: "col", label: "Col", kind: "colour", default: "accent" },
  ],
  rateHz: 10,
  defaultEnabled: true,
};

const field = (key: string) => {
  const f = manifest.settings.find((s) => s.key === key);
  if (!f) throw new Error(key);
  return f;
};

describe("sanitizeOptionValue", () => {
  it("accepts booleans only for toggles", () => {
    expect(sanitizeOptionValue(field("flag"), false)).toBe(false);
    expect(sanitizeOptionValue(field("flag"), "false")).toBe(true);
  });

  it("clamps numbers and rejects non-finite ones", () => {
    expect(sanitizeOptionValue(field("num"), 99)).toBe(20);
    expect(sanitizeOptionValue(field("num"), -4)).toBe(0);
    expect(sanitizeOptionValue(field("num"), Number.NaN)).toBe(10);
    expect(sanitizeOptionValue(field("num"), Infinity)).toBe(10);
    expect(sanitizeOptionValue(field("num"), "5")).toBe(10);
  });

  it("snaps to the step from min and removes floating error", () => {
    expect(sanitizeOptionValue(field("num"), 12)).toBe(10);
    expect(sanitizeOptionValue(field("num"), 13)).toBe(15);
    expect(sanitizeOptionValue(field("frac"), 0.3)).toBe(0.3);
    expect(sanitizeOptionValue(field("frac"), 0.34)).toBe(0.3);
  });

  it("accepts only offered select values", () => {
    expect(sanitizeOptionValue(field("pick"), "y")).toBe("y");
    expect(sanitizeOptionValue(field("pick"), "q")).toBe("x");
    expect(sanitizeOptionValue(field("pick"), 3)).toBe("x");
  });

  it("accepts accent or #rrggbb and lower-cases it", () => {
    expect(sanitizeOptionValue(field("col"), "#AABBCC")).toBe("#aabbcc");
    expect(sanitizeOptionValue(field("col"), "accent")).toBe("accent");
    expect(sanitizeOptionValue(field("col"), "#abc")).toBe("accent");
    expect(sanitizeOptionValue(field("col"), "red")).toBe("accent");
  });

  it("keeps valid unique multi picks in order and cuts to max", () => {
    expect(sanitizeOptionValue(field("many"), ["z", "q", "z", "x", "y"])).toEqual(["z", "x"]);
    expect(sanitizeOptionValue(field("many"), [1, "y"])).toEqual(["y"]);
  });

  it("gives the default for a non-array multi", () => {
    expect(sanitizeOptionValue(field("many"), "x")).toEqual(["x"]);
  });
});

describe("mergeFieldConfig", () => {
  it("keeps stored order, drops unknown ids and duplicates", () => {
    const out = mergeFieldConfig(manifest, [
      { id: "c", visible: false, widthPct: 20 },
      { id: "gone", visible: true, widthPct: null },
      { id: "a", visible: true, widthPct: null },
      { id: "c", visible: true, widthPct: 50 },
    ]);
    expect(out.map((f) => f.id)).toEqual(["c", "a", "b", "d"]);
    expect(out[0]).toEqual({ id: "c", visible: false, widthPct: 20 });
  });

  it("appends missing manifest fields with their defaults", () => {
    const out = mergeFieldConfig(manifest, [{ id: "d", visible: true, widthPct: null }]);
    expect(out.slice(1)).toEqual([
      { id: "a", visible: true, widthPct: null },
      { id: "b", visible: false, widthPct: null },
      { id: "c", visible: true, widthPct: null },
    ]);
  });

  it("falls back to the default for a non-boolean visible", () => {
    const out = mergeFieldConfig(manifest, [{ id: "b", visible: "yes", widthPct: null }]);
    expect(out[0]?.visible).toBe(false);
  });

  it("clamps widthPct to 1..100 and nulls anything else", () => {
    const out = mergeFieldConfig(manifest, [
      { id: "a", visible: true, widthPct: 400 },
      { id: "b", visible: true, widthPct: -3 },
      { id: "c", visible: true, widthPct: "30" },
      { id: "d", visible: true, widthPct: Number.NaN },
    ]);
    expect(out.map((f) => f.widthPct)).toEqual([100, 1, null, null]);
  });

  it("returns the defaults for a non-array", () => {
    expect(mergeFieldConfig(manifest, 7)).toEqual(defaultInstanceSettings(manifest).common.fields);
  });
});

describe("sanitizeInstanceSettings", () => {
  it("gives defaults for garbage", () => {
    expect(sanitizeInstanceSettings(manifest, "nope")).toEqual(defaultInstanceSettings(manifest));
  });

  it("uses defaultEnabled unless enabled is a boolean", () => {
    expect(sanitizeInstanceSettings(manifest, { enabled: "yes" }).enabled).toBe(true);
    expect(sanitizeInstanceSettings(manifest, { enabled: false }).enabled).toBe(false);
  });

  it("validates common numbers with COMMON_LIMITS", () => {
    const s = sanitizeInstanceSettings(manifest, {
      common: {
        opacityPct: 3,
        scalePct: 123,
        rowOpacityPct: 1000,
        hideInGarage: 1,
        alwaysShow: true,
      },
    });
    expect(s.common).toMatchObject({
      opacityPct: 20,
      scalePct: 125,
      rowOpacityPct: 100,
      hideInGarage: false,
      alwaysShow: true,
    });
  });

  it("keeps exactly the manifest option keys", () => {
    const s = sanitizeInstanceSettings(manifest, { options: { num: 15, extra: 1 } });
    expect(Object.keys(s.options).sort()).toEqual(manifest.settings.map((o) => o.key).sort());
    expect(s.options.num).toBe(15);
  });

  it("loads a file from an older version", () => {
    const s = sanitizeInstanceSettings(manifest, {
      enabled: false,
      common: {
        opacityPct: 80,
        removedCommon: true,
        fields: [
          { id: "oldColumn", visible: true, widthPct: null },
          { id: "c", visible: true, widthPct: 12 },
          { id: "a", visible: false, widthPct: null },
        ],
      },
      options: { removedOption: 1, pick: "retired", num: 5 },
    });
    expect(s.enabled).toBe(false);
    expect(s.common.opacityPct).toBe(80);
    expect(s.common.fields.map((f) => f.id)).toEqual(["c", "a", "b", "d"]);
    expect(s.options.pick).toBe("x");
    expect(s.options.num).toBe(5);
    expect(s.options).not.toHaveProperty("removedOption");
  });
});

describe("showTitleBar", () => {
  const base = defaultInstanceSettings(manifest);

  it("defaults to false", () => {
    expect(base.common.showTitleBar).toBe(false);
  });

  it("loads as false from a stored file without the key", () => {
    const s = sanitizeInstanceSettings(manifest, { common: { opacityPct: 80 } });
    expect(s.common.showTitleBar).toBe(false);
    const file = parseOverlaySettingsFile(
      { version: 1, overlays: { test: { enabled: true, common: { scalePct: 150 } } } },
      [manifest],
    );
    expect(file.overlays.test?.common.showTitleBar).toBe(false);
  });

  it("round-trips true", () => {
    const s = sanitizeInstanceSettings(manifest, { common: { showTitleBar: true } });
    expect(s.common.showTitleBar).toBe(true);
    const again = sanitizeInstanceSettings(manifest, JSON.parse(JSON.stringify(s)));
    expect(again.common.showTitleBar).toBe(true);
  });

  it("ignores a non-boolean and keeps the default", () => {
    expect(
      sanitizeInstanceSettings(manifest, { common: { showTitleBar: 1 } }).common.showTitleBar,
    ).toBe(false);
    const on = applySettingsPatch(manifest, base, { common: { showTitleBar: true } });
    const next = applySettingsPatch(manifest, on, { common: { showTitleBar: "yes" } });
    expect(next.common.showTitleBar).toBe(true);
  });

  it("applies a patch", () => {
    const next = applySettingsPatch(manifest, base, { common: { showTitleBar: true } });
    expect(next.common.showTitleBar).toBe(true);
    expect(next.common.opacityPct).toBe(100);
  });
});

describe("applySettingsPatch", () => {
  const base = defaultInstanceSettings(manifest);

  it("ignores a non-object patch", () => {
    expect(applySettingsPatch(manifest, base, null)).toBe(base);
    expect(applySettingsPatch(manifest, base, [1])).toBe(base);
  });

  it("replaces given keys and keeps the rest", () => {
    const next = applySettingsPatch(manifest, base, {
      enabled: false,
      common: { scalePct: 150 },
      options: { flag: false },
    });
    expect(next.enabled).toBe(false);
    expect(next.common.scalePct).toBe(150);
    expect(next.common.opacityPct).toBe(100);
    expect(next.options.flag).toBe(false);
    expect(next.options.num).toBe(10);
  });

  it("ignores invalid parts instead of resetting them", () => {
    const current: OverlayInstanceSettings = {
      ...base,
      common: { ...base.common, scalePct: 150 },
      options: { ...base.options, num: 15 },
    };
    const next = applySettingsPatch(manifest, current, {
      enabled: "x",
      common: { scalePct: "big", hideOnTrack: true },
      options: { num: "many", unknown: 1, flag: false },
    });
    expect(next.common.scalePct).toBe(150);
    expect(next.common.hideOnTrack).toBe(true);
    expect(next.options.num).toBe(15);
    expect(next.options.flag).toBe(false);
    expect(next.options).not.toHaveProperty("unknown");
  });

  it("replaces the whole fields list and merges it", () => {
    const next = applySettingsPatch(manifest, base, {
      common: { fields: [{ id: "d", visible: false, widthPct: 10 }] },
    });
    expect(next.common.fields.map((f) => f.id)).toEqual(["d", "a", "b", "c"]);
    expect(next.common.fields[0]).toEqual({ id: "d", visible: false, widthPct: 10 });
  });

  it("does not mutate the current settings", () => {
    const copy = structuredClone(base);
    applySettingsPatch(manifest, base, { common: { scalePct: 50 }, options: { num: 0 } });
    expect(base).toEqual(copy);
  });
});

describe("parseOverlaySettingsFile", () => {
  const other: OverlayManifest = { ...manifest, id: "other", defaultEnabled: false };

  it.each([undefined, null, "x", { version: 2, overlays: { test: { enabled: false } } }])(
    "gives defaults for a bad file (%j)",
    (raw) => {
      const file = parseOverlaySettingsFile(raw, [manifest, other]);
      expect(file.version).toBe(1);
      expect(file.overlays.test).toEqual(defaultInstanceSettings(manifest));
      expect(file.overlays.other).toEqual(defaultInstanceSettings(other));
    },
  );

  it("sanitises known entries and drops unknown ids", () => {
    const file = parseOverlaySettingsFile(
      { version: 1, overlays: { test: { enabled: false }, retired: { enabled: true } } },
      [manifest, other],
    );
    expect(file.overlays.test?.enabled).toBe(false);
    expect(Object.keys(file.overlays)).toEqual(["test", "other"]);
  });
});

describe("visibleFields and typed readers", () => {
  const settings = defaultInstanceSettings(manifest);

  it("lists visible fields in order", () => {
    expect(visibleFields(settings).map((f) => f.id)).toEqual(["a", "c", "d"]);
  });

  it("reads typed options", () => {
    expect(optionBoolean(settings, "flag")).toBe(true);
    expect(optionNumber(settings, "num")).toBe(10);
    expect(optionString(settings, "pick")).toBe("x");
    expect(optionStrings(settings, "many")).toEqual(["x"]);
  });

  it("throws on a missing key or wrong type", () => {
    expect(() => optionBoolean(settings, "missing")).toThrow();
    expect(() => optionNumber(settings, "flag")).toThrow();
    expect(() => optionString(settings, "many")).toThrow();
    expect(() => optionStrings(settings, "pick")).toThrow();
  });
});
