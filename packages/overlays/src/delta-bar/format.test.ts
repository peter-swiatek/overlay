import { DEFAULT_DISPLAY_PREFS } from "@overlay/ui/types";
import { describe, expect, it } from "vitest";
import { formatLapDelta, formatSpeedDelta, formatStripLapTime } from "./format";

describe("formatLapDelta", () => {
  it("prints signed two decimals", () => {
    expect(formatLapDelta(0.42)).toBe("+0.42");
    expect(formatLapDelta(-0.31)).toBe("-0.31");
    expect(formatLapDelta(0)).toBe("0.00");
    expect(formatLapDelta(-0.0001)).toBe("0.00");
  });
  it("caps at 9.99", () => {
    expect(formatLapDelta(9.994)).toBe("+9.99");
    expect(formatLapDelta(9.999)).toBe("+9.99");
    expect(formatLapDelta(-9.999)).toBe("-9.99");
    expect(formatLapDelta(10)).toBe("+9.99");
    expect(formatLapDelta(-10)).toBe("-9.99");
    expect(formatLapDelta(75)).toBe("+9.99");
    expect(formatLapDelta(-75)).toBe("-9.99");
  });
  it("shows -- for null and non-finite", () => {
    expect(formatLapDelta(null)).toBe("--");
    expect(formatLapDelta(Number.NaN)).toBe("--");
  });
});

describe("formatStripLapTime", () => {
  it("formats valid laps", () => {
    expect(formatStripLapTime(99.41)).toBe("1:39.410");
  });
  it("shows the placeholder for invalid laps", () => {
    expect(formatStripLapTime(null)).toBe("--:--.---");
    expect(formatStripLapTime(0)).toBe("--:--.---");
    expect(formatStripLapTime(-3)).toBe("--:--.---");
    expect(formatStripLapTime(Number.NaN)).toBe("--:--.---");
  });
});

describe("formatSpeedDelta", () => {
  it("signs whole numbers in the user's unit", () => {
    expect(formatSpeedDelta(4 / 3.6, DEFAULT_DISPLAY_PREFS)).toEqual({ value: "+4", unit: "km/h" });
    expect(formatSpeedDelta(-2 / 3.6, DEFAULT_DISPLAY_PREFS)).toEqual({
      value: "-2",
      unit: "km/h",
    });
    const mph = { ...DEFAULT_DISPLAY_PREFS, speedInMph: true };
    expect(formatSpeedDelta(0.44704 * 5, mph)).toEqual({ value: "+5", unit: "mph" });
  });
  it("prints 0 for a rounded zero and -- for null", () => {
    expect(formatSpeedDelta(0.1, DEFAULT_DISPLAY_PREFS).value).toBe("0");
    expect(formatSpeedDelta(-0.1, DEFAULT_DISPLAY_PREFS).value).toBe("0");
    expect(formatSpeedDelta(null, DEFAULT_DISPLAY_PREFS).value).toBe("--");
  });
});
