import { describe, expect, it } from "vitest";
import { defaultInstanceSettings } from "../settings";
import { weatherManifest as m } from "./manifest";

describe("weather manifest", () => {
  it("has the defaults of the plan and the framework visibility defaults", () => {
    expect(m.defaultSize).toEqual({ width: 240, height: 352 });
    expect(m.minSize).toEqual({ width: 200, height: 120 });
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.rateHz).toBe(10);
    expect(m.settings).toEqual([]);
    const s = defaultInstanceSettings(m);
    expect(s.enabled).toBe(false);
    expect(s.common.hideInGarage).toBe(false);
  });
  it("marks the iRacing-only fields", () => {
    const only = m.fields.filter((f) => f.sims?.join() === "iracing").map((f) => f.id);
    expect(only).toEqual(["compass", "wind", "humidity", "rain", "usage"]);
    expect(m.fields.map((f) => f.id)).toEqual([
      "compass",
      "track-temp",
      "air-temp",
      "wind",
      "humidity",
      "rain",
      "usage",
      "wetness",
    ]);
  });
});
