import { describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS, manifestById } from "./manifests";
import { OVERLAY_MODULES, moduleById } from "./modules";
import { defaultInstanceSettings } from "./settings";

describe("overlay registry", () => {
  it("has unique kebab-case ids", () => {
    const ids = OVERLAY_MANIFESTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });

  it("defaults to at least the minimum size", () => {
    for (const m of OVERLAY_MANIFESTS) {
      expect(m.defaultSize.width).toBeGreaterThanOrEqual(m.minSize.width);
      expect(m.defaultSize.height).toBeGreaterThanOrEqual(m.minSize.height);
    }
  });

  it("looks manifests up by id", () => {
    expect(manifestById("relative")?.title).toBe("Relative");
    expect(manifestById("nope")).toBeUndefined();
  });

  it("has one module per manifest", () => {
    expect(OVERLAY_MODULES.map((m) => m.manifest)).toEqual(OVERLAY_MANIFESTS);
    expect(moduleById("fuel")?.manifest.id).toBe("fuel");
  });
});

describe("defaultInstanceSettings", () => {
  it("covers every field in order and every setting", () => {
    for (const m of OVERLAY_MANIFESTS) {
      const s = defaultInstanceSettings(m);
      expect(s.enabled).toBe(m.defaultEnabled);
      expect(s.common.fields.map((f) => f.id)).toEqual(m.fields.map((f) => f.id));
      expect(Object.keys(s.options)).toEqual(m.settings.map((x) => x.key));
    }
  });

  it("applies field and setting defaults", () => {
    const s = defaultInstanceSettings({
      ...OVERLAY_MANIFESTS[0]!,
      fields: [
        { id: "a", label: "A", defaultVisible: true },
        { id: "b", label: "B", defaultVisible: false },
      ],
      settings: [{ key: "x", label: "X", kind: "toggle", default: true }],
    });
    expect(s.common.fields).toEqual([
      { id: "a", visible: true, widthPct: null },
      { id: "b", visible: false, widthPct: null },
    ]);
    expect(s.options).toEqual({ x: true });
    expect(s.common.opacityPct).toBe(100);
  });
});
