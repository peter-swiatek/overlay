import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import {
  clampToWorkArea,
  effectiveMinSize,
  growToMin,
  parseContentMin,
  defaultBounds,
  initialBounds,
  isReachable,
  parseLayout,
  placeInWorkArea,
  planWindowChanges,
  resizeBounds,
  scaleBounds,
  scaleBoundsWithChrome,
  scaleContentMin,
} from "./layout";
import { LayoutStore } from "./layout-store";

const manifest = (id: string): OverlayManifest => {
  const found = OVERLAY_MANIFESTS.find((m) => m.id === id);
  if (!found) throw new Error(`no manifest ${id}`);
  return found;
};
const relative = manifest("relative");
const demoInputs = manifest("demo-inputs");
const primary = { x: 0, y: 0, width: 1920, height: 1040 };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-layout-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("LayoutStore", () => {
  it("returns an empty layout when the file is missing", () => {
    expect(new LayoutStore(join(dir, "layout.json")).load(OVERLAY_MANIFESTS)).toEqual({});
  });

  it("round-trips a saved layout and leaves no temp file", () => {
    const file = join(dir, "nested", "layout.json");
    const store = new LayoutStore(file);
    const layout = {
      relative: { x: 5, y: 6, width: 500, height: 400, scalePct: 125 },
      "demo-inputs": { x: -1000, y: 20, width: 300, height: 150, scalePct: 100 },
    };
    store.save(layout);
    expect(store.load(OVERLAY_MANIFESTS)).toEqual(layout);
    expect(readdirSync(join(dir, "nested"))).toEqual(["layout.json"]);
  });

  it("falls back to an empty layout for corrupt files", () => {
    const file = join(dir, "layout.json");
    writeFileSync(file, "{not json");
    expect(new LayoutStore(file).load(OVERLAY_MANIFESTS)).toEqual({});
  });

  it("migrates an M1 layout file", () => {
    const file = join(dir, "layout.json");
    const m1 = {
      relative: { x: 1, y: 2, width: 360, height: 260 },
      inputs: { x: 3, y: 4, width: 360, height: 160 },
    };
    writeFileSync(file, JSON.stringify(m1));
    expect(new LayoutStore(file).load(OVERLAY_MANIFESTS)).toEqual({
      relative: { ...m1.relative, scalePct: 100 },
      "demo-inputs": { ...m1.inputs, scalePct: 100 },
    });
  });
});

describe("corrupt layout file", () => {
  it("is moved aside to .bad-<timestamp> instead of being overwritten", () => {
    const file = join(dir, "layout.json");
    writeFileSync(file, "{not json");
    const store = new LayoutStore(file);
    expect(store.load(OVERLAY_MANIFESTS)).toEqual({});
    store.save({});
    const names = readdirSync(dir);
    expect(names).toContain("layout.json");
    expect(names.some((n) => /^layout\.json\.bad-\d+$/.test(n))).toBe(true);
  });
});

describe("parseLayout", () => {
  it("reads the stored scale and defaults to 100", () => {
    const layout = parseLayout(
      {
        relative: { x: 1, y: 2, width: 300, height: 200, scalePct: 150 },
        "demo-inputs": { x: 1, y: 2, width: 300, height: 200 },
      },
      OVERLAY_MANIFESTS,
    );
    expect(layout["relative"]?.scalePct).toBe(150);
    expect(layout["demo-inputs"]?.scalePct).toBe(100);
  });

  it("drops invalid entries and unknown ids", () => {
    const layout = parseLayout(
      {
        relative: { x: 1.6, y: 2, width: 300, height: 200 },
        "demo-inputs": { x: "a", y: 2, width: 300, height: 300 },
        ghost: { x: 1, y: 2, width: 300, height: 300 },
      },
      OVERLAY_MANIFESTS,
    );
    expect(layout).toEqual({
      relative: { x: 2, y: 2, width: 300, height: 200, scalePct: 100 },
    });
  });

  it("prefers demo-inputs over the legacy inputs entry", () => {
    const layout = parseLayout(
      {
        "demo-inputs": { x: 9, y: 9, width: 300, height: 200 },
        inputs: { x: 1, y: 1, width: 300, height: 200 },
      },
      OVERLAY_MANIFESTS,
    );
    expect(layout["demo-inputs"]?.x).toBe(9);
  });

  it("ignores non-object input", () => {
    expect(parseLayout(null, OVERLAY_MANIFESTS)).toEqual({});
    expect(parseLayout([1, 2], OVERLAY_MANIFESTS)).toEqual({});
  });
});

describe("defaultBounds / initialBounds", () => {
  it("uses the work area origin, the manifest offset and the scaled size", () => {
    const area = { x: 100, y: 50, width: 1920, height: 1040 };
    expect(defaultBounds(relative, 100, area)).toEqual({
      x: 140,
      y: 650,
      width: relative.defaultSize.width,
      height: 300,
    });
    expect(defaultBounds(relative, 150, area)).toMatchObject({
      width: Math.round(relative.defaultSize.width * 1.5),
      height: 450,
    });
  });

  it("keeps reachable stored bounds and raises them to the scaled minimum", () => {
    const stored = { x: 10, y: 10, width: 100, height: 100 };
    expect(initialBounds(relative, stored, 100, [primary], primary)).toEqual({
      x: 10,
      y: 10,
      width: 260,
      height: 140,
    });
  });

  it("falls back to defaults when the stored bounds are off screen", () => {
    const stored = { x: -5000, y: 10, width: 400, height: 300 };
    expect(initialBounds(demoInputs, stored, 100, [primary], primary)).toEqual({
      x: 60,
      y: 360,
      width: 360,
      height: 160,
    });
  });

  it("moves up to fit the work area, keeping the default size", () => {
    const small = { x: 0, y: 0, width: 800, height: 700 };
    const b = initialBounds(relative, undefined, 100, [small], small);
    expect(b).toEqual({ x: 40, y: 400, width: relative.defaultSize.width, height: 300 });
  });
});

describe("planWindowChanges", () => {
  const on = { enabled: true } as OverlayInstanceSettings;
  const off = { enabled: false } as OverlayInstanceSettings;
  it("opens enabled overlays and closes disabled or unknown ones", () => {
    const plan = planWindowChanges(
      OVERLAY_MANIFESTS,
      { relative: on, leaderboard: on, spotter: off },
      ["relative", "spotter", "ghost"],
    );
    expect(plan).toEqual({ open: ["leaderboard"], close: ["spotter", "ghost"] });
  });

  it("does nothing when the open set already matches", () => {
    expect(planWindowChanges(OVERLAY_MANIFESTS, { relative: on }, ["relative"])).toEqual({
      open: [],
      close: [],
    });
  });

  it("keeps developer-only overlays closed while developer tools are off", () => {
    const dev = OVERLAY_MANIFESTS.filter((m) => m.dev === true).map((m) => m.id);
    expect(dev).toContain("demo-inputs");
    const settings = { "demo-inputs": on, relative: on };
    expect(planWindowChanges(OVERLAY_MANIFESTS, settings, [], false)).toEqual({
      open: ["relative"],
      close: [],
    });
    expect(planWindowChanges(OVERLAY_MANIFESTS, settings, ["demo-inputs"], false)).toEqual({
      open: ["relative"],
      close: ["demo-inputs"],
    });
    expect(planWindowChanges(OVERLAY_MANIFESTS, settings, [], true).open).toContain("demo-inputs");
  });

  it("treats an overlay without settings as off", () => {
    expect(planWindowChanges(OVERLAY_MANIFESTS, {}, [])).toEqual({ open: [], close: [] });
  });
});

describe("scaleBounds", () => {
  const min = { width: 260, height: 140 };
  const b = { x: 40, y: 50, width: 420, height: 300 };
  it("scales by the ratio and keeps the top-left corner", () => {
    expect(scaleBounds(b, 100, 150, min)).toEqual({ x: 40, y: 50, width: 630, height: 450 });
    expect(scaleBounds(b, 150, 100, min)).toEqual({ x: 40, y: 50, width: 280, height: 200 });
  });
  it("never goes below the minimum at the new scale", () => {
    const big = { width: 400, height: 300 };
    expect(scaleBounds({ ...b, width: 300, height: 200 }, 100, 50, big)).toEqual({
      x: 40,
      y: 50,
      width: 200,
      height: 150,
    });
  });
  it("ignores invalid scales", () => {
    expect(scaleBounds(b, 0, 100, min)).toBe(b);
  });
});

describe("resizeBounds", () => {
  const min = { width: 100, height: 80 };
  const b = { x: 10, y: 10, width: 200, height: 150 };

  it("applies deltas", () => {
    expect(resizeBounds(b, 30, -20, min)).toEqual({ x: 10, y: 10, width: 230, height: 130 });
  });

  it("clamps to the minimum size", () => {
    expect(resizeBounds(b, -500, -500, min)).toEqual({ x: 10, y: 10, width: 100, height: 80 });
  });

  it("ignores non-finite deltas", () => {
    expect(resizeBounds(b, Number.NaN, 5, min)).toBe(b);
  });
});

describe("isReachable", () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  it("detects windows left on a removed monitor", () => {
    expect(isReachable({ x: 100, y: 100, width: 300, height: 200 }, areas)).toBe(true);
    expect(isReachable({ x: -3000, y: 100, width: 300, height: 200 }, areas)).toBe(false);
    expect(isReachable({ x: 1900, y: 100, width: 300, height: 200 }, areas)).toBe(false);
  });
});

describe("clampToWorkArea", () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  const min = { width: 100, height: 80 };
  it("limits size to the work area", () => {
    expect(clampToWorkArea({ x: 600, y: 500, width: 700, height: 600 }, area, min)).toEqual({
      x: 600,
      y: 500,
      width: 400,
      height: 300,
    });
  });
  it("never goes below the minimum size", () => {
    expect(clampToWorkArea({ x: 990, y: 790, width: 150, height: 120 }, area, min)).toEqual({
      x: 990,
      y: 790,
      width: 100,
      height: 80,
    });
  });
});

describe("content minimum size", () => {
  it("parseContentMin rounds up, clamps to 0..4000 and rejects bad input", () => {
    expect(parseContentMin({ width: 300.2, height: 80 })).toEqual({ width: 301, height: 80 });
    expect(parseContentMin({ width: -5, height: 99999 })).toEqual({ width: 0, height: 4000 });
    expect(parseContentMin({ width: Number.NaN, height: 1 })).toBeUndefined();
    expect(parseContentMin({ width: "3", height: 1 })).toBeUndefined();
    expect(parseContentMin(null)).toBeUndefined();
  });

  it("effectiveMinSize is the larger of scaled manifest minimum and reported content", () => {
    const manifestMin = { width: 300, height: 160 };
    expect(effectiveMinSize(manifestMin, 150, { width: 0, height: 0 })).toEqual({
      width: 450,
      height: 240,
    });
    expect(effectiveMinSize(manifestMin, 100, { width: 520, height: 100 })).toEqual({
      width: 520,
      height: 160,
    });
  });

  it("growToMin keeps the top-left and only grows", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    const min = { width: 500, height: 200 };
    expect(growToMin({ x: 100, y: 100, width: 300, height: 400 }, min, area)).toEqual({
      x: 100,
      y: 100,
      width: 500,
      height: 400,
    });
    const big = { x: 5, y: 6, width: 800, height: 600 };
    expect(growToMin(big, min, area)).toEqual(big);
  });

  it("growToMin moves the window back onto the display when growing pushes it off", () => {
    const area = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(
      growToMin({ x: 3700, y: 1000, width: 200, height: 70 }, { width: 500, height: 200 }, area),
    ).toEqual({ x: 3340, y: 880, width: 500, height: 200 });
    // Larger than the display: stays at the display's top-left.
    expect(
      growToMin({ x: 2000, y: 10, width: 200, height: 70 }, { width: 2500, height: 200 }, area),
    ).toEqual({ x: 1920, y: 10, width: 2500, height: 200 });
  });
});

describe("title bar chrome when rescaling", () => {
  const min = { width: 10, height: 10 };
  it("scales only the content under a fixed title bar", () => {
    const b = { x: 5, y: 5, width: 400, height: 220 };
    expect(scaleBoundsWithChrome(b, 100, 50, min, 20)).toEqual({
      x: 5,
      y: 5,
      width: 200,
      height: 120,
    });
    expect(scaleBoundsWithChrome(b, 100, 200, min, 20)).toEqual({
      x: 5,
      y: 5,
      width: 800,
      height: 420,
    });
    expect(scaleBoundsWithChrome(b, 100, 50, min, 0)).toEqual(scaleBounds(b, 100, 50, min));
  });
  it("keeps the title bar out of a scaled content minimum", () => {
    expect(scaleContentMin({ width: 300, height: 120 }, 50, 20)).toEqual({
      width: 150,
      height: 70,
    });
    expect(scaleContentMin({ width: 300, height: 0 }, 50, 20)).toEqual({ width: 150, height: 0 });
  });
});

describe("fit width and option size bookkeeping", () => {
  it("keeps a finite positive fitWidth and a string sizedFor", () => {
    const layout = parseLayout(
      {
        relative: { x: 1, y: 2, width: 300, height: 200, fitWidth: 455, sizedFor: "horizontal" },
      },
      OVERLAY_MANIFESTS,
    );
    expect(layout["relative"]).toEqual({
      x: 1,
      y: 2,
      width: 300,
      height: 200,
      scalePct: 100,
      fitWidth: 455,
      sizedFor: "horizontal",
    });
  });

  it("drops junk fitWidth and sizedFor", () => {
    for (const junk of [0, -4, Number.NaN, null, {}]) {
      const layout = parseLayout(
        { relative: { x: 1, y: 2, width: 300, height: 200, fitWidth: junk, sizedFor: junk } },
        OVERLAY_MANIFESTS,
      );
      expect(layout["relative"]).toEqual({ x: 1, y: 2, width: 300, height: 200, scalePct: 100 });
    }
  });

  it("round-trips through the store", () => {
    const store = new LayoutStore(join(dir, "layout.json"));
    store.save({
      relative: { x: 5, y: 6, width: 480, height: 300, scalePct: 100, fitWidth: 455.5 },
    });
    expect(store.load(OVERLAY_MANIFESTS)["relative"]?.fitWidth).toBe(455.5);
  });

  it("effectiveMinSize folds the table minimum into the width", () => {
    const manifestMin = { width: 300, height: 160 };
    expect(effectiveMinSize(manifestMin, 100, { width: 0, height: 0 }, 380)).toEqual({
      width: 380,
      height: 160,
    });
    expect(effectiveMinSize(manifestMin, 100, { width: 400, height: 0 }, 380).width).toBe(400);
    expect(effectiveMinSize(manifestMin, 100, { width: 0, height: 0 }, 100).width).toBe(300);
  });
});

describe("placeInWorkArea", () => {
  const min = { width: 220, height: 120 };
  const screen = { x: 0, y: 0, width: 1280, height: 720 };

  it("keeps the size and moves a window that overhangs the right and bottom edges", () => {
    expect(placeInWorkArea({ x: 1360, y: 560, width: 250, height: 360 }, screen, min)).toEqual({
      x: 1030,
      y: 360,
      width: 250,
      height: 360,
    });
  });
  it("leaves a window that fits alone", () => {
    const b = { x: 100, y: 100, width: 300, height: 200 };
    expect(placeInWorkArea(b, screen, min)).toEqual(b);
  });
  it("shrinks only when the size exceeds the area, never below the minimum", () => {
    expect(placeInWorkArea({ x: 50, y: 50, width: 2000, height: 100 }, screen, min)).toEqual({
      x: 0,
      y: 50,
      width: 1280,
      height: 100,
    });
    const tiny = { x: 0, y: 0, width: 200, height: 100 };
    expect(placeInWorkArea({ x: 150, y: 10, width: 300, height: 100 }, tiny, min).width).toBe(220);
  });
  it("respects a work area that does not start at the origin", () => {
    const area = { x: 1920, y: 40, width: 1280, height: 720 };
    expect(placeInWorkArea({ x: 3000, y: 700, width: 500, height: 300 }, area, min)).toEqual({
      x: 2700,
      y: 460,
      width: 500,
      height: 300,
    });
  });
  it("keeps the Fuel default size on a 1280 wide screen", () => {
    const fuel = manifest("fuel");
    const b = defaultBounds(fuel, 100, screen);
    expect(b.width).toBe(fuel.defaultSize.width);
    expect(b.x + b.width).toBeLessThanOrEqual(screen.width);
    expect(b.y + b.height).toBeLessThanOrEqual(screen.height);
    expect(initialBounds(fuel, undefined, 100, [screen], screen)).toEqual(b);
  });
});
