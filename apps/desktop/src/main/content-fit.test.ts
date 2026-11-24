import type { OverlayManifest } from "@overlay/overlays/contract";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import { describe, expect, it } from "vitest";
import {
  FIT_MIN_EDGE_PX,
  fitAxisOf,
  fitMinSize,
  fitsHeight,
  fitsWidth,
  gripDelta,
  planContentFit,
} from "./content-fit";

const byId = (id: string): OverlayManifest => {
  const m = OVERLAY_MANIFESTS.find((x) => x.id === id);
  if (!m) throw new Error(id);
  return m;
};
const area = { x: 0, y: 0, width: 1920, height: 1040 };
const bounds = { x: 100, y: 200, width: 480, height: 400 };
const min = { width: 220, height: 20 };

describe("fitAxisOf", () => {
  it("reads the manifest axis with the instance options", () => {
    expect(fitAxisOf(byId("fuel"), {})).toBe("height");
    expect(fitAxisOf(byId("radar"), {})).toBe("none");
    expect(fitAxisOf(byId("leaderboard"), { "show-all": true })).toBe("none");
    expect(fitAxisOf(byId("leaderboard"), { "show-all": false })).toBe("height");
  });
  it("is none without options (unknown instance)", () => {
    expect(fitAxisOf(byId("fuel"), undefined)).toBe("none");
  });
  it("names the edges of each axis", () => {
    expect([fitsHeight("height"), fitsWidth("height")]).toEqual([true, false]);
    expect([fitsHeight("both"), fitsWidth("both")]).toEqual([true, true]);
    expect([fitsHeight("none"), fitsWidth("none")]).toEqual([false, false]);
  });
});

describe("fitMinSize", () => {
  const manifestMin = { width: 220, height: 120 };
  const none = { width: 0, height: 0 };
  it("keeps the manifest minimum on edges the user sizes", () => {
    expect(fitMinSize(manifestMin, 100, none, 0, "none")).toEqual({ width: 220, height: 120 });
  });
  it("drops the manifest height minimum to the floor when the height fits", () => {
    expect(fitMinSize(manifestMin, 100, none, 0, "height")).toEqual({
      width: 220,
      height: FIT_MIN_EDGE_PX,
    });
  });
  it("drops both when both edges fit, and keeps the floor in DIPs at any scale", () => {
    expect(fitMinSize(manifestMin, 100, none, 0, "both")).toEqual({ width: 20, height: 20 });
    expect(fitMinSize(manifestMin, 200, none, 0, "both")).toEqual({ width: 20, height: 20 });
  });
  it("still honours the content and column minimums", () => {
    expect(fitMinSize(manifestMin, 100, { width: 300, height: 150 }, 350, "height")).toEqual({
      width: 350,
      height: 150,
    });
  });
});

describe("planContentFit", () => {
  const plan = (over: Partial<Parameters<typeof planContentFit>[0]> = {}) =>
    planContentFit({
      axis: "height",
      bounds,
      natural: { width: 300, height: 195 },
      min,
      area,
      ...over,
    });

  it("shrinks a too-tall window to the content, keeping the top-left and the width", () => {
    expect(plan()).toEqual({ x: 100, y: 200, width: 480, height: 195 });
  });
  it("grows to the content when sections are switched on", () => {
    expect(plan({ natural: { width: 300, height: 520 } })).toEqual({
      x: 100,
      y: 200,
      width: 480,
      height: 520,
    });
  });
  it("sets the width as well for both", () => {
    expect(plan({ axis: "both" })).toEqual({ x: 100, y: 200, width: 300, height: 195 });
  });
  it("does nothing for none", () => {
    expect(plan({ axis: "none" })).toBeNull();
  });
  it("ignores changes under 1 DIP", () => {
    expect(plan({ natural: { width: 300, height: 400 } })).toBeNull();
    expect(plan({ bounds: { ...bounds, height: 195.5 } })).toBeNull();
  });
  it("never goes below the window minimum", () => {
    expect(plan({ natural: { width: 300, height: 10 } })?.height).toBe(20);
    expect(plan({ axis: "both", natural: { width: 100, height: 195 } })?.width).toBe(220);
  });
  it("ignores an unmeasured (0) edge", () => {
    expect(plan({ axis: "both", natural: { width: 0, height: 195 } })?.width).toBe(480);
  });
  it("moves up when the new height would run past the bottom of the work area", () => {
    const next = plan({ bounds: { ...bounds, y: 900 }, natural: { width: 300, height: 300 } });
    expect(next).toEqual({ x: 100, y: 1040 - 300, width: 480, height: 300 });
  });
  it("cuts an edge larger than the work area to it", () => {
    const next = plan({ natural: { width: 300, height: 2000 } });
    expect(next).toEqual({ x: 100, y: 0, width: 480, height: 1040 });
  });
  it("keeps x when only the height changes, even if the window overhangs the right edge", () => {
    const next = plan({ bounds: { ...bounds, x: 1700 } });
    expect(next?.x).toBe(1700);
  });
  it("respects a work area that is not at the origin", () => {
    const second = { x: 1920, y: 0, width: 1280, height: 984 };
    const next = plan({ area: second, bounds: { x: 2000, y: 900, width: 480, height: 50 } });
    expect(next).toEqual({ x: 2000, y: 984 - 195, width: 480, height: 195 });
  });
});

describe("gripDelta", () => {
  it("drops the drag on the edges that follow the content", () => {
    expect(gripDelta("none", 10, 20)).toEqual({ dx: 10, dy: 20 });
    expect(gripDelta("height", 10, 20)).toEqual({ dx: 10, dy: 0 });
    expect(gripDelta("both", 10, 20)).toEqual({ dx: 0, dy: 0 });
  });
});
