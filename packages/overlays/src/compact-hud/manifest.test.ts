import { describe, expect, it } from "vitest";
import { defaultInstanceSettings } from "../settings";
import { compactHudManifest as m } from "./manifest";

describe("compact-hud manifest", () => {
  it("has the fixed geometry and starts disabled and hidden in the garage", () => {
    expect(m.defaultSize).toEqual({ width: 340, height: 172 });
    expect(m.minSize).toEqual(m.defaultSize);
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
      "show-pit-countdown": true,
      "show-slow-car": true,
      "slow-car-range": 300,
      "shift-lights": "car",
    });
  });
});
