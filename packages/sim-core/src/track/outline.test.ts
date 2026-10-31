import { describe, expect, it } from "vitest";
import { closedLength, isTrackOutline, pointAtPct, signedArea } from "./outline";
import { squareOutline } from "./synthetic";

describe("pointAtPct", () => {
  const outline = squareOutline();

  it("returns the point of the lap fraction and interpolates between points", () => {
    expect(pointAtPct(outline, 0)).toEqual([0, 0]);
    expect(pointAtPct(outline, 0.25)).toEqual([1, 0]);
    const [x, y] = pointAtPct(outline, 0.125);
    expect(x).toBeCloseTo(0.5, 9);
    expect(y).toBe(0);
    const [x2, y2] = pointAtPct(outline, 0.0005);
    expect(x2).toBeCloseTo(0.002, 9);
    expect(y2).toBe(0);
  });

  it("treats the lap as a loop: 1 is 0, and other values wrap", () => {
    expect(pointAtPct(outline, 1)).toEqual(pointAtPct(outline, 0));
    expect(pointAtPct(outline, 1.25)).toEqual(pointAtPct(outline, 0.25));
    expect(pointAtPct(outline, -0.25)).toEqual(pointAtPct(outline, 0.75));
    // Between the last point and the first one a lap later.
    const [x, y] = pointAtPct(outline, 0.9995);
    expect(x).toBe(0);
    expect(y).toBeCloseTo(0.002, 9);
  });
});

describe("outline helpers", () => {
  const outline = squareOutline();

  it("measures the closed length and the winding", () => {
    expect(closedLength(outline.points)).toBeCloseTo(4, 9);
    // Right, down, left, up on a y-down screen is clockwise.
    expect(signedArea(outline.points)).toBeCloseTo(1, 9);
    expect(signedArea([...outline.points].reverse())).toBeCloseTo(-1, 9);
  });

  it("validates an outline that crossed a boundary", () => {
    expect(isTrackOutline(outline)).toBe(true);
    expect(isTrackOutline(JSON.parse(JSON.stringify(outline)))).toBe(true);
    expect(isTrackOutline(null)).toBe(false);
    expect(isTrackOutline({ ...outline, version: 2 })).toBe(false);
    expect(isTrackOutline({ ...outline, source: "gps" })).toBe(false);
    expect(isTrackOutline({ ...outline, points: outline.points.slice(1) })).toBe(false);
    expect(isTrackOutline({ ...outline, points: outline.points.map(() => [0]) })).toBe(false);
    expect(isTrackOutline({ ...outline, scaleM: Number.NaN })).toBe(false);
  });
});
