import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY_PREFS } from "./index";

describe("ui", () => {
  it("defaults to metric units and a 24 hour clock", () => {
    expect(DEFAULT_DISPLAY_PREFS).toEqual({
      units: "metric",
      speedInMph: false,
      timeFormat: "24h",
    });
  });
});
