import { describe, expect, it } from "vitest";
import {
  autoReferenceKind,
  parseReferenceMode,
  referenceLabel,
  resolveReferenceKind,
  type AutoReferenceInput,
} from "./select";
import type { DeltaReferenceKind } from "./types";

const ALL: Partial<Record<DeltaReferenceKind, true>> = {
  allTimeBest: true,
  sessionBestClean: true,
  sessionBest: true,
  lastLap: true,
};

function auto(over: Partial<AutoReferenceInput>): DeltaReferenceKind | null {
  return autoReferenceKind({
    sessionType: "practice",
    sessionTypeName: "Open Practice",
    lapNumber: 5,
    available: ALL,
    ...over,
  });
}

describe("autoReferenceKind", () => {
  it("uses the last lap on race laps 1 and 2, not 3", () => {
    expect(auto({ sessionType: "race", lapNumber: 1 })).toBe("lastLap");
    expect(auto({ sessionType: "race", lapNumber: 2 })).toBe("lastLap");
    expect(auto({ sessionType: "race", lapNumber: 3 })).toBe("sessionBestClean");
    expect(auto({ sessionType: "race", lapNumber: null })).toBe("sessionBestClean");
  });

  it("uses the last lap in offline testing, any case", () => {
    expect(auto({ sessionTypeName: "Offline Testing" })).toBe("lastLap");
    expect(auto({ sessionTypeName: "offline testing" })).toBe("lastLap");
  });

  it("uses the all-time best in qualifying, else the last lap", () => {
    expect(auto({ sessionType: "qualifying" })).toBe("allTimeBest");
    expect(
      auto({ sessionType: "qualifying", available: { lastLap: true, sessionBest: true } }),
    ).toBe("lastLap");
  });

  it("prefers the clean session best, then the session best", () => {
    expect(auto({})).toBe("sessionBestClean");
    expect(auto({ available: { sessionBest: true, lastLap: true } })).toBe("sessionBest");
    expect(auto({ sessionType: "warmup", sessionTypeName: null })).toBe("sessionBestClean");
    expect(auto({ sessionType: null })).toBe("sessionBestClean");
  });

  it("is null when nothing is available", () => {
    expect(auto({ available: {} })).toBeNull();
    expect(auto({ sessionType: "qualifying", available: {} })).toBeNull();
  });
});

describe("resolveReferenceKind", () => {
  it("auto takes the auto kind when available", () => {
    expect(resolveReferenceKind("auto", "allTimeBest", ALL)).toBe("allTimeBest");
    expect(resolveReferenceKind("auto", null, ALL)).toBe("lastLap");
    expect(resolveReferenceKind("auto", null, {})).toBeNull();
  });

  it("session best prefers the clean lap", () => {
    expect(resolveReferenceKind("sessionBest", null, ALL)).toBe("sessionBestClean");
    expect(resolveReferenceKind("sessionBest", null, { sessionBest: 1, lastLap: 1 })).toBe(
      "sessionBest",
    );
    expect(resolveReferenceKind("sessionBest", null, { lastLap: 1 })).toBe("lastLap");
  });

  it("all-time best and last lap fall back to the last lap, then null", () => {
    expect(resolveReferenceKind("allTimeBest", null, ALL)).toBe("allTimeBest");
    expect(resolveReferenceKind("allTimeBest", null, { lastLap: 1 })).toBe("lastLap");
    expect(resolveReferenceKind("allTimeBest", null, {})).toBeNull();
    expect(resolveReferenceKind("lastLap", null, ALL)).toBe("lastLap");
    expect(resolveReferenceKind("lastLap", null, { allTimeBest: 1 })).toBeNull();
  });
});

describe("parseReferenceMode", () => {
  it("keeps known values and turns junk into auto", () => {
    expect(parseReferenceMode("sessionBest")).toBe("sessionBest");
    expect(parseReferenceMode("allTimeBest")).toBe("allTimeBest");
    expect(parseReferenceMode("lastLap")).toBe("lastLap");
    expect(parseReferenceMode("auto")).toBe("auto");
    expect(parseReferenceMode("bogus")).toBe("auto");
    expect(parseReferenceMode(3)).toBe("auto");
    expect(parseReferenceMode(undefined)).toBe("auto");
  });
});

describe("referenceLabel", () => {
  it("labels every kind", () => {
    expect(referenceLabel("allTimeBest")).toBe("All-time best");
    expect(referenceLabel("sessionBestClean")).toBe("Session best");
    expect(referenceLabel("sessionBest")).toBe("Session best");
    expect(referenceLabel("lastLap")).toBe("Last lap");
  });
});
