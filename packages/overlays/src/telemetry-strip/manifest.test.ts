import { describe, expect, it } from "vitest";
import { defaultInstanceSettings } from "../settings";
import { telemetryStripManifest as m } from "./manifest";

describe("telemetry-strip manifest", () => {
  it("has the fixed geometry and starts disabled and hidden in the garage", () => {
    expect(m.defaultSize).toEqual({ width: 594, height: 136 });
    expect(m.minSize).toEqual(m.defaultSize);
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.rateHz).toBe(30);
    const s = defaultInstanceSettings(m);
    expect(s.enabled).toBe(false);
    expect(s.common.hideInGarage).toBe(true);
    expect(s.options).toEqual({ "shift-lights": "car" });
  });
  it("lists every field, all visible", () => {
    expect(m.fields.map((f) => f.id)).toEqual([
      "gear-ring",
      "speed",
      "shift-lights",
      "rpm",
      "position",
      "fuel",
      "last-lap",
      "track-temp",
    ]);
    expect(m.fields.every((f) => f.defaultVisible)).toBe(true);
  });
});
