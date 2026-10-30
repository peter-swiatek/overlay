import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OVERLAY_DEFINITIONS,
  clampToWorkArea,
  isReachable,
  parseLayout,
  resizeBounds,
} from "./layout";
import { LayoutStore } from "./layout-store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-layout-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("LayoutStore", () => {
  it("returns defaults when the file is missing", () => {
    const layout = new LayoutStore(join(dir, "layout.json")).load();
    expect(layout.relative).toEqual(OVERLAY_DEFINITIONS[0]?.defaultBounds);
    expect(layout.inputs).toEqual(OVERLAY_DEFINITIONS[1]?.defaultBounds);
  });

  it("round-trips a saved layout and leaves no temp file", () => {
    const file = join(dir, "nested", "layout.json");
    const store = new LayoutStore(file);
    const layout = {
      relative: { x: 5, y: 6, width: 500, height: 400 },
      inputs: { x: -1000, y: 20, width: 300, height: 150 },
    };
    store.save(layout);
    expect(store.load()).toEqual(layout);
    expect(readdirSync(join(dir, "nested"))).toEqual(["layout.json"]);
  });

  it("falls back to defaults for corrupt files", () => {
    const file = join(dir, "layout.json");
    writeFileSync(file, "{not json");
    expect(new LayoutStore(file).load()).toEqual(parseLayout(undefined));
  });
});

describe("parseLayout", () => {
  it("replaces invalid entries and enforces the minimum size", () => {
    const layout = parseLayout({
      relative: { x: 1.6, y: 2, width: 10, height: 10 },
      inputs: { x: "a", y: 2, width: 300, height: 300 },
    });
    expect(layout.relative).toEqual({ x: 2, y: 2, width: 240, height: 180 });
    expect(layout.inputs).toEqual(OVERLAY_DEFINITIONS[1]?.defaultBounds);
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
