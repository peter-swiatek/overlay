import { describe, expect, it } from "vitest";
import { shouldReport } from "./contentMin";

describe("shouldReport", () => {
  it("reports the first measurement", () => {
    expect(shouldReport(null, { width: 300, height: 0 })).toBe(true);
  });
  it("ignores changes under 2 px", () => {
    expect(shouldReport({ width: 300, height: 100 }, { width: 301, height: 99 })).toBe(false);
  });
  it("reports a change of 2 px or more on either edge", () => {
    expect(shouldReport({ width: 300, height: 100 }, { width: 302, height: 100 })).toBe(true);
    expect(shouldReport({ width: 300, height: 100 }, { width: 300, height: 90 })).toBe(true);
  });
});
