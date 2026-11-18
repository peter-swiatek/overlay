import { describe, expect, it } from "vitest";
import { defaultInstanceSettings, sanitizeInstanceSettings } from "../settings";
import { compactHudManifest as m } from "./manifest";

describe("compact-hud manifest", () => {
  it("has the fixed geometry and starts disabled and hidden in the garage", () => {
    expect(m.defaultSize).toEqual({ width: 340, height: 284 });
    expect(m.minSize).toEqual({ width: 255, height: 213 });
    expect(m.sims).toEqual(["iracing"]);
    expect(m.rateHz).toBe(30);
    expect(m.fields).toEqual([]);
    const s = defaultInstanceSettings(m);
    expect(s.enabled).toBe(false);
    expect(s.common.hideInGarage).toBe(true);
    expect(s.common.hideOnTrack).toBe(false);
  });
  it("has the expected settings", () => {
    expect(defaultInstanceSettings(m).options).toEqual({
      "show-gap-tabs": true,
      "gap-range": 5,
      "show-proximity": true,
      "show-pit-guide": true,
      "show-slow-car": true,
      "slow-car-range": 300,
      "shift-lights": "car",
    });
  });
  it("reads the earlier pit countdown option when the pit guide option is absent", () => {
    const old = sanitizeInstanceSettings(m, { options: { "show-pit-countdown": false } });
    expect(old.options["show-pit-guide"]).toBe(false);
    expect(old.options).not.toHaveProperty("show-pit-countdown");
    const both = sanitizeInstanceSettings(m, {
      options: { "show-pit-countdown": false, "show-pit-guide": true },
    });
    expect(both.options["show-pit-guide"]).toBe(true);
  });
});
