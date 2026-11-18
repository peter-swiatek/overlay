import { describe, expect, it } from "vitest";
import type { DisplayPrefs } from "../types";
import {
  formatClockTime,
  formatDelta,
  formatDistance,
  formatDriverName,
  formatGap,
  formatIRating,
  formatLapTime,
  formatNameDisplay,
  formatPercent,
  formatPressure,
  formatSessionTime,
  formatSpeed,
  formatTemperature,
  formatTimeOfDay,
  formatVolume,
  licenceColourVar,
  parseLicence,
} from "./index";

const METRIC: DisplayPrefs = { units: "metric", speedInMph: false, timeFormat: "24h" };
const IMPERIAL: DisplayPrefs = { units: "imperial", speedInMph: false, timeFormat: "12h" };

describe("lap time, delta, gap", () => {
  it("formats lap times", () => {
    expect(formatLapTime(106.238)).toBe("1:46.238");
    expect(formatLapTime(106.238, 1)).toBe("1:46.2");
    expect(formatLapTime(106.238, 0)).toBe("1:46");
    expect(formatLapTime(46.238)).toBe("46.238");
    expect(formatLapTime(65.004, 2)).toBe("1:05.00");
  });
  it("carries rounding into the minute", () => {
    expect(formatLapTime(59.9996)).toBe("1:00.000");
    expect(formatLapTime(59.96, 1)).toBe("1:00.0");
  });
  it("gives -- for missing laps", () => {
    for (const v of [null, 0, -1, NaN, Infinity]) expect(formatLapTime(v)).toBe("--");
  });
  it("formats deltas with sign", () => {
    expect(formatDelta(0.62)).toBe("+0.6");
    expect(formatDelta(-1.27)).toBe("-1.3");
    expect(formatDelta(0)).toBe("0.0");
    expect(formatDelta(-0)).toBe("0.0");
    expect(formatDelta(-0.04)).toBe("0.0");
    expect(formatDelta(0.123, 2)).toBe("+0.12");
    expect(formatDelta(null)).toBe("--");
    expect(formatDelta(NaN)).toBe("--");
  });
  it("formats gaps", () => {
    expect(formatGap({ laps: 1, seconds: 3 })).toBe("+1 L");
    expect(formatGap({ laps: 2, seconds: null })).toBe("+2 L");
    expect(formatGap({ laps: 0, seconds: 4.34 })).toBe("+4.3");
    expect(formatGap({ laps: 0, seconds: 4.346 }, 2)).toBe("+4.35");
    expect(formatGap({ laps: 0, seconds: 0 })).toBe("--");
    expect(formatGap({ laps: 0, seconds: null })).toBe("--");
    expect(formatGap(null)).toBe("--");
  });
});

describe("session and clock times", () => {
  it("formats session time", () => {
    expect(formatSessionTime(5847)).toBe("1:37:27");
    expect(formatSessionTime(726)).toBe("12:06");
    expect(formatSessionTime(45.9)).toBe("0:45");
    expect(formatSessionTime(3600)).toBe("1:00:00");
    expect(formatSessionTime(null)).toBe("--");
    expect(formatSessionTime(NaN)).toBe("--");
  });
  it("formats clock time in 24 h and 12 h", () => {
    expect(formatClockTime(new Date(2025, 0, 1, 14, 5), METRIC)).toBe("14:05");
    expect(formatClockTime(new Date(2025, 0, 1, 14, 5), IMPERIAL)).toBe("2:05 PM");
    expect(formatClockTime(new Date(2025, 0, 1, 0, 7), METRIC)).toBe("00:07");
    expect(formatClockTime(new Date(2025, 0, 1, 0, 7), IMPERIAL)).toBe("12:07 AM");
    expect(formatClockTime(new Date(2025, 0, 1, 12, 0), IMPERIAL)).toBe("12:00 PM");
  });
  it("formats time of day with wrap", () => {
    expect(formatTimeOfDay(14 * 3600 + 5 * 60, METRIC)).toBe("14:05");
    expect(formatTimeOfDay(14 * 3600 + 5 * 60, IMPERIAL)).toBe("2:05 PM");
    expect(formatTimeOfDay(0, IMPERIAL)).toBe("12:00 AM");
    expect(formatTimeOfDay(86400 + 60, METRIC)).toBe("00:01");
    expect(formatTimeOfDay(-60, METRIC)).toBe("23:59");
    expect(formatTimeOfDay(null, METRIC)).toBe("--");
  });
});

describe("units", () => {
  it("speed", () => {
    expect(formatSpeed(50, METRIC)).toEqual({ value: "180", unit: "km/h" });
    expect(formatSpeed(44.704, IMPERIAL)).toEqual({ value: "100", unit: "mph" });
    expect(formatSpeed(44.704, { ...METRIC, speedInMph: true })).toEqual({
      value: "100",
      unit: "mph",
    });
    expect(formatSpeed(50, METRIC, 1).value).toBe("180.0");
    expect(formatSpeed(null, METRIC)).toEqual({ value: "--", unit: "km/h" });
    expect(formatSpeed(NaN, IMPERIAL)).toEqual({ value: "--", unit: "mph" });
  });
  it("volume", () => {
    expect(formatVolume(10, METRIC)).toEqual({ value: "10.0", unit: "L" });
    expect(formatVolume(3.785411784, IMPERIAL)).toEqual({ value: "1.0", unit: "gal" });
    expect(formatVolume(null, IMPERIAL)).toEqual({ value: "--", unit: "gal" });
  });
  it("temperature", () => {
    expect(formatTemperature(20, METRIC)).toEqual({ value: "20.0", unit: "°C" });
    expect(formatTemperature(100, IMPERIAL, 0)).toEqual({ value: "212", unit: "°F" });
    expect(formatTemperature(-40, IMPERIAL, 0).value).toBe("-40");
    expect(formatTemperature(null, METRIC)).toEqual({ value: "--", unit: "°C" });
  });
  it("distance", () => {
    expect(formatDistance(12.4, METRIC)).toEqual({ value: "12", unit: "m" });
    expect(formatDistance(0.3048, IMPERIAL, 1)).toEqual({ value: "1.0", unit: "ft" });
    expect(formatDistance(null, IMPERIAL).unit).toBe("ft");
  });
  it("pressure", () => {
    expect(formatPressure(200, METRIC, 0)).toEqual({ value: "200", unit: "kPa" });
    expect(formatPressure(6.894757, IMPERIAL)).toEqual({ value: "1.0", unit: "psi" });
    expect(formatPressure(null, METRIC)).toEqual({ value: "--", unit: "kPa" });
  });
  it("percent", () => {
    expect(formatPercent(0.823)).toBe("82%");
    expect(formatPercent(0.8234, 1)).toBe("82.3%");
    expect(formatPercent(null)).toBe("--");
  });
});

describe("names", () => {
  it("formats every name format", () => {
    const n = "Max Example";
    expect(formatDriverName(n, "full")).toBe("Max Example");
    expect(formatDriverName(n, "f-last")).toBe("M. Example");
    expect(formatDriverName(n, "first-l")).toBe("Max E.");
    expect(formatDriverName(n, "last")).toBe("Example");
    expect(formatDriverName(n, "first")).toBe("Max");
    expect(formatDriverName(n, "last-f")).toBe("Example, M.");
  });
  it("uses first and last tokens, middle only in full", () => {
    const n = "  José   María Pérez ";
    expect(formatDriverName(n, "full")).toBe("José María Pérez");
    expect(formatDriverName(n, "f-last")).toBe("J. Pérez");
    expect(formatDriverName(n, "first-l")).toBe("José P.");
    expect(formatDriverName(n, "last-f")).toBe("Pérez, J.");
  });
  it("keeps hyphenated parts together and handles accents", () => {
    expect(formatDriverName("Anna-Lena Example-Driver", "f-last")).toBe("A. Example-Driver");
    expect(formatDriverName("Zofia Świątkowska", "first-l")).toBe("Zofia Ś.");
    expect(formatDriverName("świątek Zofia", "f-last")).toBe("Ś. Zofia");
  });
  it("never splits a surrogate pair", () => {
    expect(formatDriverName("𝒜lex Example", "f-last")).toBe("𝒜. Example");
  });
  it("returns one-word names as is, and empty for null", () => {
    for (const f of ["full", "f-last", "first-l", "last", "first", "last-f"] as const) {
      expect(formatDriverName("Prost", f)).toBe("Prost");
    }
    expect(formatDriverName(null, "full")).toBe("");
    expect(formatDriverName("   ", "full")).toBe("");
  });
  it("combines driver and team", () => {
    expect(formatNameDisplay("Max Example", "Team Name", "driver-team", "f-last")).toBe(
      "M. Example · Team Name",
    );
    expect(formatNameDisplay("Max Example", "Team Name", "driver", "f-last")).toBe("M. Example");
    expect(formatNameDisplay("Max Example", "Team Name", "team", "f-last")).toBe("Team Name");
    expect(formatNameDisplay("Max Example", null, "team", "last")).toBe("Example");
    expect(formatNameDisplay(null, "Team Name", "driver-team", "full")).toBe("Team Name");
    expect(formatNameDisplay(null, null, "driver-team", "full")).toBe("");
  });
});

describe("iRating and licence", () => {
  it("formats iRating", () => {
    expect(formatIRating(1550)).toBe("1.6k");
    expect(formatIRating(980)).toBe("980");
    expect(formatIRating(1000)).toBe("1.0k");
    expect(formatIRating(12345)).toBe("12.3k");
    expect(formatIRating(null)).toBe("--");
  });
  it("parses licences", () => {
    expect(parseLicence("A 3.41")).toEqual({ licenceClass: "A", safetyRating: 3.41 });
    expect(parseLicence("Class A 3.41")).toEqual({ licenceClass: "A", safetyRating: 3.41 });
    expect(parseLicence("P 4.99")).toEqual({ licenceClass: "P", safetyRating: 4.99 });
    expect(parseLicence("WC 2.50")).toEqual({ licenceClass: "P", safetyRating: 2.5 });
    expect(parseLicence("r 1.00").licenceClass).toBe("R");
    expect(parseLicence("B")).toEqual({ licenceClass: "B", safetyRating: null });
    expect(parseLicence("Rookie 2.0")).toEqual({ licenceClass: null, safetyRating: null });
    expect(parseLicence(null)).toEqual({ licenceClass: null, safetyRating: null });
    expect(parseLicence("")).toEqual({ licenceClass: null, safetyRating: null });
  });
  it("maps licence classes to locked colour variables", () => {
    expect(licenceColourVar("A")).toBe("var(--ov-locked-licence-a)");
    expect(licenceColourVar("P")).toBe("var(--ov-locked-licence-pro)");
    expect(licenceColourVar(null)).toBe("var(--ov-text-muted)");
  });
});
