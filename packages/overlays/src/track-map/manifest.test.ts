import { describe, expect, it } from "vitest";
import { defaultInstanceSettings } from "../settings";
import { trackMapManifest as m } from "./manifest";

describe("track map manifest", () => {
  it("has the defaults of the plan", () => {
    expect(m.id).toBe("track-map");
    expect(m.title).toBe("Track Map");
    expect(m.defaultSize).toEqual({ width: 360, height: 300 });
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.table).toBe(false);
    expect(m.fields).toEqual([]);
    expect(m.rateHz).toBeGreaterThanOrEqual(10);
    expect(m.rateHz).toBeLessThanOrEqual(20);
    const s = defaultInstanceSettings(m);
    expect(s.enabled).toBe(false);
    expect(s.common.hideInGarage).toBe(false);
  });

  it("has the two label toggles, both on", () => {
    expect(m.settings.map((f) => [f.key, f.label, f.kind])).toEqual([
      ["corner-labels", "Corner labels", "toggle"],
      ["car-numbers", "Car numbers", "toggle"],
    ]);
    expect(defaultInstanceSettings(m).options).toEqual({
      "corner-labels": true,
      "car-numbers": true,
    });
  });
});
