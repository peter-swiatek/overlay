import { describe, expect, it } from "vitest";
import { shouldReport, withTitleBar } from "./contentMin";

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

describe("withTitleBar", () => {
  it("adds the 20 px bar to a measured height only when it is in flow", () => {
    expect(withTitleBar({ width: 300, height: 100 }, true, true)).toEqual({
      width: 300,
      height: 120,
    });
    expect(withTitleBar({ width: 300, height: 100 }, false, true)).toEqual({
      width: 300,
      height: 100,
    });
  });
  it("leaves a table's absent height at 0", () => {
    expect(withTitleBar({ width: 300, height: 0 }, true, false)).toEqual({ width: 300, height: 0 });
  });
});
