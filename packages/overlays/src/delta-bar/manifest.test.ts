import { describe, expect, it } from "vitest";
import { defaultInstanceSettings } from "../settings";
import { deltaBarManifest as m } from "./manifest";

describe("delta-bar manifest", () => {
  it("has the defaults of the plan", () => {
    expect(m.defaultSize).toEqual({ width: 560, height: 131 });
    expect(m.minSize).toEqual({ width: 360, height: 101 });
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.rateHz).toBe(20);
    expect(m.fields).toEqual([]);
    const s = defaultInstanceSettings(m);
    expect(s.enabled).toBe(false);
    expect(s.common.hideInGarage).toBe(true);
  });
  it("has the expected settings", () => {
    expect(defaultInstanceSettings(m).options).toEqual({
      "show-delta-speed": true,
      "show-best-times": true,
      "show-head-to-head": true,
      reference: "auto",
      "bar-range": "2",
      "hide-below": 35,
    });
    const ref = m.settings.find((x) => x.key === "reference");
    expect(ref?.kind === "select" && ref.options.map((o) => o.value)).toEqual([
      "auto",
      "sessionBest",
      "allTimeBest",
      "lastLap",
    ]);
  });
});
