import { describe, expect, it } from "vitest";
import { fitChanged, fitWindowSize, measureNatural } from "./contentFit";

describe("fitChanged", () => {
  it("reports the first measurement", () => {
    expect(fitChanged(null, { width: 300, height: 100 })).toBe(true);
  });
  it("reports a change of 1 px or more on either edge", () => {
    expect(fitChanged({ width: 300, height: 100 }, { width: 300, height: 101 })).toBe(true);
    expect(fitChanged({ width: 300, height: 100 }, { width: 299, height: 100 })).toBe(true);
  });
  it("ignores an unchanged size", () => {
    expect(fitChanged({ width: 300, height: 100 }, { width: 300, height: 100 })).toBe(false);
  });
});

describe("fitWindowSize", () => {
  it("adds the in-flow title bar to the height", () => {
    expect(fitWindowSize({ width: 300, height: 100 }, true)).toEqual({ width: 300, height: 120 });
    expect(fitWindowSize({ width: 300, height: 100 }, false)).toEqual({ width: 300, height: 100 });
  });
});

/** A stand-in element: its rect depends on the inline width/height the measurement sets. */
function fakeElement(): { el: HTMLElement; seen: string[] } {
  const seen: string[] = [];
  const style = { width: "", height: "100%" };
  const el = {
    style,
    getBoundingClientRect: () => {
      seen.push(`${style.width}|${style.height}`);
      const width = style.width === "max-content" ? 312.4 : 480;
      const height = style.height === "min-content" ? 194.2 : 400;
      return { width, height } as DOMRect;
    },
  } as unknown as HTMLElement;
  return { el, seen };
}

describe("measureNatural", () => {
  it("measures the content's own height at the current width, rounded up", () => {
    const { el, seen } = fakeElement();
    expect(measureNatural(el, "height")).toEqual({ width: 480, height: 195 });
    expect(seen).toEqual(["|min-content"]);
  });
  it("measures at the max-content width for both", () => {
    const { el, seen } = fakeElement();
    expect(measureNatural(el, "both")).toEqual({ width: 313, height: 195 });
    expect(seen).toEqual(["max-content|min-content"]);
  });
  it("puts the inline styles back", () => {
    const { el } = fakeElement();
    measureNatural(el, "both");
    expect(el.style.width).toBe("");
    expect(el.style.height).toBe("100%");
  });
});
