import { describe, expect, it } from "vitest";
import { metricsChanged, readMetrics, whenFontsReady } from "./tableMetrics";

describe("readMetrics", () => {
  it("divides the 100 ch span by 100 and reads the padding", () => {
    expect(readMetrics(860, " 7px")).toEqual({ chPx: 8.6, cellPadPx: 7 });
    expect(readMetrics(900, "5px")).toEqual({ chPx: 9, cellPadPx: 5 });
  });
  it("is null for a zero or non-finite width", () => {
    expect(readMetrics(0, "7px")).toBeNull();
    expect(readMetrics(Number.NaN, "7px")).toBeNull();
    expect(readMetrics(Number.POSITIVE_INFINITY, "7px")).toBeNull();
  });
  it("falls back to 7 px when the padding is unreadable", () => {
    expect(readMetrics(860, "")?.cellPadPx).toBe(7);
    expect(readMetrics(860, "wide")?.cellPadPx).toBe(7);
  });
});

describe("metricsChanged", () => {
  const base = { chPx: 8.6, cellPadPx: 7 };
  it("reports the first measurement", () => {
    expect(metricsChanged(null, base)).toBe(true);
  });
  it("ignores moves under 0.01 px", () => {
    expect(metricsChanged(base, { chPx: 8.605, cellPadPx: 7 })).toBe(false);
  });
  it("reports a move of 0.01 px or more on either value", () => {
    expect(metricsChanged(base, { chPx: 8.7, cellPadPx: 7 })).toBe(true);
    expect(metricsChanged(base, { chPx: 8.6, cellPadPx: 5 })).toBe(true);
  });
});

describe("whenFontsReady", () => {
  it("waits for document.fonts.ready", async () => {
    let resolve: () => void = () => undefined;
    const ready = new Promise<void>((r) => {
      resolve = r;
    });
    let called = 0;
    whenFontsReady({ fonts: { ready } }, () => {
      called += 1;
    });
    await Promise.resolve();
    expect(called).toBe(0);
    resolve();
    await ready;
    await Promise.resolve();
    expect(called).toBe(1);
  });
  it("runs at once when the font API is missing", () => {
    let called = 0;
    whenFontsReady({}, () => {
      called += 1;
    });
    expect(called).toBe(1);
  });
});
