import { describe, expect, it } from "vitest";
import {
  instanceId,
  instancesOf,
  instanceTitle,
  isAddedInstance,
  manifestForInstance,
  MAX_INSTANCES,
  nextInstanceId,
  parseInstanceId,
} from "./instances";
import { OVERLAY_MANIFESTS, manifestById } from "./manifests";
import {
  applySettingsPatch,
  defaultInstanceSettings,
  newInstanceSettings,
  parseOverlaySettingsFile,
  resetInstanceSettings,
} from "./settings";

const relative = manifestById("relative")!;

describe("instance keys", () => {
  it("keeps the manifest id for instance 1 and adds :n for the others", () => {
    expect(instanceId("relative", 1)).toBe("relative");
    expect(instanceId("relative", 3)).toBe("relative:3");
    expect(parseInstanceId("relative")).toEqual({ overlayId: "relative", n: 1 });
    expect(parseInstanceId("data-frames:12")).toEqual({ overlayId: "data-frames", n: 12 });
  });

  it("rejects keys that are not canonical", () => {
    for (const bad of [
      "relative:1",
      "relative:01",
      `relative:${MAX_INSTANCES + 1}`,
      "Rel",
      ":2",
      "a:b",
      "relative:2:3",
      "",
    ]) {
      expect(parseInstanceId(bad)).toBeNull();
    }
    expect(isAddedInstance("relative")).toBe(false);
    expect(isAddedInstance("relative:2")).toBe(true);
  });

  it("finds the manifest of an instance", () => {
    expect(manifestForInstance("relative:4", OVERLAY_MANIFESTS)).toBe(relative);
    expect(manifestForInstance("nope:2", OVERLAY_MANIFESTS)).toBeUndefined();
  });

  it("lists an overlay's instances in order and picks the lowest free number", () => {
    const ids = ["relative:3", "fuel", "relative", "relative:5", "fuel:2"];
    expect(instancesOf("relative", ids)).toEqual(["relative", "relative:3", "relative:5"]);
    expect(nextInstanceId("relative", ids)).toBe("relative:2");
    expect(nextInstanceId("fuel", ids)).toBe("fuel:3");
    const full = Array.from({ length: MAX_INSTANCES }, (_, i) => instanceId("fuel", i + 1));
    expect(nextInstanceId("fuel", full)).toBeNull();
  });

  it("names instances by title and number unless the user named them", () => {
    expect(instanceTitle(relative, "relative")).toBe("Relative");
    expect(instanceTitle(relative, "relative:2")).toBe("Relative 2");
    expect(instanceTitle(relative, "relative:2", "  Rear view ")).toBe("Rear view");
    expect(instanceTitle(relative, "relative:2", " ")).toBe("Relative 2");
  });
});

describe("instance settings", () => {
  it("reads added instances of known overlays from the settings file and drops the rest", () => {
    const file = parseOverlaySettingsFile(
      {
        version: 1,
        overlays: {
          "relative:3": { enabled: true, name: "Wide", common: { scalePct: 150 } },
          "relative:2": { enabled: false },
          "relative:1": { enabled: true },
          "nope:2": { enabled: true },
          "relative:x": { enabled: true },
        },
      },
      OVERLAY_MANIFESTS,
    );
    const ids = Object.keys(file.overlays);
    expect(ids.filter((id) => id.startsWith("relative"))).toEqual([
      "relative",
      "relative:2",
      "relative:3",
    ]);
    expect(ids).not.toContain("nope:2");
    expect(ids).not.toContain("relative:1");
    expect(file.overlays["relative:3"]).toMatchObject({
      enabled: true,
      name: "Wide",
      common: { scalePct: 150 },
    });
    // Instance 1 keeps reading the plain manifest id, so existing files are unchanged.
    expect(file.overlays["relative"]).toEqual(defaultInstanceSettings(relative));
    expect(file.overlays["relative"]).not.toHaveProperty("name");
  });

  it("copies the source instance, switched on and unnamed, for a new instance", () => {
    const source = applySettingsPatch(relative, defaultInstanceSettings(relative), {
      enabled: false,
      name: "Main",
      common: { scalePct: 120 },
    });
    const copy = newInstanceSettings(relative, source, "relative:2");
    expect(copy.enabled).toBe(true);
    expect(copy).not.toHaveProperty("name");
    expect(copy.common.scalePct).toBe(120);
    expect(copy.options).toEqual(source.options);
    // A deep copy: changing the new one never touches the source.
    copy.common.fields[0]!.visible = !source.common.fields[0]!.visible;
    expect(source.common.fields[0]!.visible).not.toBe(copy.common.fields[0]!.visible);
  });

  it("sets, trims, caps and clears the name through a patch", () => {
    const base = defaultInstanceSettings(relative);
    const named = applySettingsPatch(relative, base, { name: "  Behind   me  " });
    expect(named.name).toBe("Behind me");
    expect(applySettingsPatch(relative, named, { name: "x".repeat(60) }).name).toHaveLength(40);
    expect(applySettingsPatch(relative, named, { name: "" })).not.toHaveProperty("name");
    expect(applySettingsPatch(relative, named, { name: 3 } as never).name).toBe("Behind me");
    expect(applySettingsPatch(relative, named, { enabled: true }).name).toBe("Behind me");
  });

  it("resets an added instance but keeps its enabled state and name", () => {
    const s = applySettingsPatch(relative, defaultInstanceSettings(relative), {
      enabled: true,
      name: "Two",
      common: { opacityPct: 50 },
    });
    expect(resetInstanceSettings(relative, s, "relative:2")).toEqual({
      ...defaultInstanceSettings(relative),
      enabled: true,
      name: "Two",
    });
    expect(resetInstanceSettings(relative, s, "relative")).toEqual(
      defaultInstanceSettings(relative),
    );
  });
});
