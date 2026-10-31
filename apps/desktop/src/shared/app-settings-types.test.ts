import { describe, expect, it } from "vitest";
import { IPC } from "./types";
import { DEFAULT_APP_SETTINGS, displayPrefsOf } from "./app-settings-types";

describe("displayPrefsOf", () => {
  it("picks only the display preferences", () => {
    expect(displayPrefsOf(DEFAULT_APP_SETTINGS)).toEqual({
      units: "metric",
      speedInMph: false,
      timeFormat: "24h",
    });
    const custom = {
      ...DEFAULT_APP_SETTINGS,
      general: {
        ...DEFAULT_APP_SETTINGS.general,
        units: "imperial" as const,
        timeFormat: "12h" as const,
      },
    };
    expect(displayPrefsOf(custom)).toEqual({
      units: "imperial",
      speedInMph: false,
      timeFormat: "12h",
    });
  });
});

describe("IPC", () => {
  it("has a unique channel for every key", () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
  });
});
