import { describe, expect, it } from "vitest";
import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import { defaultInstanceSettings } from "@overlay/overlays/settings";
import { NOMINAL_TABLE_METRICS } from "@overlay/ui/fit";
import {
  fitTarget,
  parseTableMetrics,
  planAutoWidth,
  planOptionSize,
  retargetScale,
} from "./auto-width";

const relative = OVERLAY_MANIFESTS.find((m) => m.id === "relative") as OverlayManifest;
const inputs = OVERLAY_MANIFESTS.find((m) => !m.table) as OverlayManifest;
const area = { x: 0, y: 0, width: 1920, height: 1040 };

function withScale(settings: OverlayInstanceSettings, scalePct: number): OverlayInstanceSettings {
  return { ...settings, common: { ...settings.common, scalePct } };
}

describe("parseTableMetrics", () => {
  it("accepts in-range numbers", () => {
    expect(parseTableMetrics({ chPx: 8.6, cellPadPx: 7 })).toEqual({ chPx: 8.6, cellPadPx: 7 });
    expect(parseTableMetrics({ chPx: 1, cellPadPx: 0 })).toBeDefined();
    expect(parseTableMetrics({ chPx: 100, cellPadPx: 100 })).toBeDefined();
  });
  it("rejects out-of-range, non-numeric and non-object input", () => {
    expect(parseTableMetrics({ chPx: 0.5, cellPadPx: 7 })).toBeUndefined();
    expect(parseTableMetrics({ chPx: 101, cellPadPx: 7 })).toBeUndefined();
    expect(parseTableMetrics({ chPx: 8, cellPadPx: -1 })).toBeUndefined();
    expect(parseTableMetrics({ chPx: 8, cellPadPx: 101 })).toBeUndefined();
    expect(parseTableMetrics({ chPx: Number.NaN, cellPadPx: 7 })).toBeUndefined();
    expect(parseTableMetrics({ chPx: "8", cellPadPx: 7 })).toBeUndefined();
    expect(parseTableMetrics({ chPx: 8 })).toBeUndefined();
    expect(parseTableMetrics(null)).toBeUndefined();
    expect(parseTableMetrics(8)).toBeUndefined();
  });
});

describe("fitTarget", () => {
  const settings = defaultInstanceSettings(relative);
  it("scales the fit and the minimum by the overlay scale", () => {
    const at100 = fitTarget(relative, settings, NOMINAL_TABLE_METRICS);
    const at150 = fitTarget(relative, withScale(settings, 150), NOMINAL_TABLE_METRICS);
    expect(at100.fitWidth).toBeGreaterThan(300);
    expect(at100.minWidth).toBeGreaterThan(0);
    expect(at100.minWidth).toBeLessThan(at100.fitWidth ?? 0);
    expect(Math.abs((at150.fitWidth ?? 0) - (at100.fitWidth ?? 0) * 1.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(at150.minWidth - at100.minWidth * 1.5)).toBeLessThanOrEqual(1);
  });
  it("has no fit in custom width mode but keeps the minimum", () => {
    const custom = { ...settings, options: { ...settings.options, "column-width": "custom" } };
    const target = fitTarget(relative, custom, NOMINAL_TABLE_METRICS);
    expect(target.fitWidth).toBeNull();
    expect(target.minWidth).toBeGreaterThan(0);
  });
  it("is empty for a non-table overlay", () => {
    expect(fitTarget(inputs, defaultInstanceSettings(inputs), NOMINAL_TABLE_METRICS)).toEqual({
      fitWidth: null,
      minWidth: 0,
    });
  });
});

describe("fitTarget with a sim", () => {
  const leaderboard = OVERLAY_MANIFESTS.find((m) => m.id === "leaderboard") as OverlayManifest;
  const settings = defaultInstanceSettings(leaderboard);
  it("drops iRacing-only columns in LMU, as the overlay does", () => {
    const unknown = fitTarget(leaderboard, settings, NOMINAL_TABLE_METRICS);
    const iracing = fitTarget(leaderboard, settings, NOMINAL_TABLE_METRICS, "iracing");
    const lmu = fitTarget(leaderboard, settings, NOMINAL_TABLE_METRICS, "lmu");
    expect(iracing).toEqual(unknown);
    expect(lmu.fitWidth ?? 0).toBeLessThan(unknown.fitWidth ?? 0);
  });
});

describe("retargetScale", () => {
  it("converts a target from the current scale to the stored scale", () => {
    expect(retargetScale({ fitWidth: 942, minWidth: 300 }, 150, 100)).toEqual({
      fitWidth: 628,
      minWidth: 200,
    });
  });
  it("keeps a null fit and ignores equal or invalid scales", () => {
    expect(retargetScale({ fitWidth: null, minWidth: 90 }, 150, 100)).toEqual({
      fitWidth: null,
      minWidth: 60,
    });
    const t = { fitWidth: 500, minWidth: 100 };
    expect(retargetScale(t, 100, 100)).toBe(t);
    expect(retargetScale(t, 0, 100)).toBe(t);
  });
  it("leaves a closed overlay's stored width unchanged after a scale change", () => {
    const settings = defaultInstanceSettings(relative);
    const at100 = fitTarget(relative, settings, NOMINAL_TABLE_METRICS);
    const at150 = fitTarget(relative, withScale(settings, 150), NOMINAL_TABLE_METRICS);
    const stored = retargetScale(at150, 150, 100);
    const plan = planAutoWidth({
      bounds: { x: 0, y: 0, width: at100.fitWidth ?? 0, height: 300 },
      storedFitWidth: at100.fitWidth ?? undefined,
      target: stored,
      area,
    });
    expect(plan.bounds).toBeNull();
  });
});

describe("planAutoWidth", () => {
  const bounds = { x: 100, y: 50, width: 480, height: 300 };
  const target = { fitWidth: 455, minWidth: 380 };

  it("fits on first use (no stored fit width) keeping x, y and height", () => {
    expect(planAutoWidth({ bounds, storedFitWidth: undefined, target, area })).toEqual({
      bounds: { x: 100, y: 50, width: 455, height: 300 },
      fitWidth: 455,
    });
  });
  it("does nothing when the fit is unchanged, whatever the user dragged", () => {
    const dragged = { ...bounds, width: 400 };
    expect(planAutoWidth({ bounds: dragged, storedFitWidth: 455, target, area })).toEqual({
      bounds: null,
      fitWidth: 455,
    });
    expect(
      planAutoWidth({ bounds: dragged, storedFitWidth: 455.4, target, area }).bounds,
    ).toBeNull();
  });
  it("grows and shrinks when the fit changes", () => {
    const grow = { fitWidth: 520, minWidth: 380 };
    const shrink = { fitWidth: 420, minWidth: 380 };
    expect(planAutoWidth({ bounds, storedFitWidth: 455, target: grow, area })).toEqual({
      bounds: { x: 100, y: 50, width: 520, height: 300 },
      fitWidth: 520,
    });
    expect(planAutoWidth({ bounds, storedFitWidth: 455, target: shrink, area })).toEqual({
      bounds: { x: 100, y: 50, width: 420, height: 300 },
      fitWidth: 420,
    });
  });
  it("never goes below the minimum width", () => {
    const plan = planAutoWidth({
      bounds,
      storedFitWidth: 455,
      target: { fitWidth: 300, minWidth: 380 },
      area,
    });
    expect(plan.bounds?.width).toBe(380);
    expect(plan.fitWidth).toBe(300);
  });
  it("clamps at the work area edge but stores the unclamped target", () => {
    const plan = planAutoWidth({
      bounds: { ...bounds, x: 1400 },
      storedFitWidth: 455,
      target: { fitWidth: 600, minWidth: 380 },
      area,
    });
    expect(plan.bounds?.width).toBe(520);
    expect(plan.bounds?.x).toBe(1400);
    expect(plan.fitWidth).toBe(600);
  });
  it("keeps the stored fit when there is no fit (custom mode)", () => {
    expect(
      planAutoWidth({
        bounds,
        storedFitWidth: 455,
        target: { fitWidth: null, minWidth: 380 },
        area,
      }),
    ).toEqual({ bounds: null, fitWidth: 455 });
    expect(
      planAutoWidth({
        bounds,
        storedFitWidth: undefined,
        target: { fitWidth: null, minWidth: 0 },
        area,
      }),
    ).toEqual({ bounds: null, fitWidth: undefined });
  });
});

describe("planOptionSize", () => {
  const manifest: OverlayManifest = {
    ...inputs,
    minSize: { width: 220, height: 120 },
    sizeByOption: {
      key: "layout",
      sizes: {
        vertical: { width: 250, height: 360 },
        horizontal: { width: 480, height: 196 },
      },
    },
  };
  const base = defaultInstanceSettings(inputs);
  const settingsFor = (layout: string, scalePct = 100): OverlayInstanceSettings => ({
    ...base,
    common: { ...base.common, scalePct },
    options: { ...base.options, layout },
  });
  const bounds = { x: 40, y: 30, width: 250, height: 360 };
  const plan = (
    layout: string,
    sizedFor: string | undefined,
    over: { b?: typeof bounds; chromePx?: number; scalePct?: number } = {},
  ) =>
    planOptionSize({
      manifest,
      settings: settingsFor(layout, over.scalePct),
      sizedFor,
      bounds: over.b ?? bounds,
      area,
      chromePx: over.chromePx ?? 0,
    });

  it("switches vertical to horizontal and back, keeping x and y", () => {
    const h = plan("horizontal", "vertical");
    expect(h).toEqual({
      bounds: { x: 40, y: 30, width: 480, height: 196 },
      sizedFor: "horizontal",
    });
    const v = plan("vertical", "horizontal", { b: h.bounds ?? bounds });
    expect(v).toEqual({
      bounds: { x: 40, y: 30, width: 250, height: 360 },
      sizedFor: "vertical",
    });
  });
  it("only records when sizedFor is undefined, and does nothing when unchanged", () => {
    expect(plan("horizontal", undefined)).toEqual({ bounds: null, sizedFor: "horizontal" });
    expect(plan("vertical", "vertical")).toEqual({ bounds: null, sizedFor: "vertical" });
  });
  it("scales the size and adds the title bar chrome", () => {
    const next = plan("horizontal", "vertical", { chromePx: 20, scalePct: 150 });
    expect(next.bounds).toEqual({ x: 40, y: 30, width: 720, height: 294 + 20 });
  });
  it("moves left to stay inside the work area, keeping the size", () => {
    const next = plan("horizontal", "vertical", { b: { ...bounds, x: 1600 } });
    expect(next.bounds?.width).toBe(480);
    expect(next.bounds?.x).toBe(1920 - 480);
    expect(next.sizedFor).toBe("horizontal");
  });
  it("ignores manifests without sizeByOption and unknown values", () => {
    expect(
      planOptionSize({
        manifest: inputs,
        settings: settingsFor("horizontal"),
        sizedFor: "vertical",
        bounds,
        area,
        chromePx: 0,
      }),
    ).toEqual({ bounds: null, sizedFor: "vertical" });
    expect(plan("diagonal", "vertical")).toEqual({ bounds: null, sizedFor: "vertical" });
  });
});
