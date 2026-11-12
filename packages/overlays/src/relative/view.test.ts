import type { Car, DerivedGap, TelemetryFrame } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, fixtureFrame, lapStatus } from "../shared";
import { gapThreat, relativeView, type RelativeOptions } from "./view";

const OPTIONS: RelativeOptions = {
  ahead: 3,
  behind: 3,
  hideInPits: false,
  gapThreat: true,
  livePositions: true,
  gapDecimals: 1,
  lapDecimals: 3,
};

/** Car 0 is the focus car; `gaps` maps carIdx to the raw relative gap. */
function frameWith(
  gaps: Record<number, number | null>,
  carOverrides: Record<number, Partial<Car>> = {},
  extra: { playerCarIdx?: number | null } = {},
): TelemetryFrame {
  const idxs = [0, ...Object.keys(gaps).map(Number)];
  const derivedGaps: DerivedGap[] = Object.entries(gaps).map(([carIdx, gapS]) => ({
    carIdx: Number(carIdx),
    gapS,
    tier: gapS === null ? "unavailable" : "position",
  }));
  return fixtureFrame({
    playerCarIdx: extra.playerCarIdx === undefined ? 0 : extra.playerCarIdx,
    cars: idxs.map((carIdx) => ({
      carIdx,
      driverName: FIXTURE_NAMES[carIdx % FIXTURE_NAMES.length] ?? null,
      ...carOverrides[carIdx],
    })),
    gaps: derivedGaps,
  });
}

const ids = (frame: TelemetryFrame, options: Partial<RelativeOptions> = {}): number[] =>
  relativeView(frame, { ...OPTIONS, ...options }).rows.map((r) => r.carIdx);

describe("relativeView", () => {
  const many = { 1: -9, 2: -1, 3: -4, 4: -0.5, 5: 0.7, 6: 8, 7: 2, 8: 3, 9: 40 };

  it("orders farthest ahead first, the focus car in the middle, farthest behind last", () => {
    expect(ids(frameWith(many))).toEqual([3, 2, 4, 0, 5, 7, 8]);
    const rows = relativeView(frameWith(many), OPTIONS).rows;
    expect(rows.find((r) => r.carIdx === 0)).toMatchObject({ isFocus: true, relativeGapS: 0 });
  });

  it("honours counts from 0 to 8 and copes with fewer cars than asked", () => {
    const frame = frameWith(many);
    expect(ids(frame, { ahead: 0, behind: 0 })).toEqual([0]);
    expect(ids(frame, { ahead: 1, behind: 2 })).toEqual([4, 0, 5, 7]);
    expect(ids(frame, { ahead: 8, behind: 8 })).toEqual([1, 3, 2, 4, 0, 5, 7, 8, 6, 9]);
  });

  it("hides cars on pit road but never the focus car", () => {
    const frame = frameWith(many, { 4: { onPitRoad: true }, 0: { onPitRoad: true } });
    expect(ids(frame, { hideInPits: true })).toEqual([1, 3, 2, 0, 5, 7, 8]);
    expect(ids(frame)).toContain(4);
  });

  it("drops cars with no gap and cars that are not connected", () => {
    const frame = frameWith({ 1: -1, 2: null, 3: 1, 4: 2 }, { 4: { connected: false } });
    expect(ids(frame)).toEqual([1, 0, 3]);
  });

  it("keeps -0.04 s ahead and uncoloured, and +0.04 s behind and red", () => {
    const view = relativeView(frameWith({ 1: -0.04, 2: 0.04 }), OPTIONS);
    expect(view.rows.map((r) => r.carIdx)).toEqual([1, 0, 2]);
    expect(view.rows.map((r) => r.relativeGapS)).toEqual([0, 0, 0]);
    expect(view.threats).toEqual({ 2: "red" });
  });

  it("applies threat thresholds after rounding (decimals 1 and 0)", () => {
    const gaps = { 1: 1.04, 2: 1.06, 3: 2.04, 4: 2.06 };
    expect(relativeView(frameWith(gaps), OPTIONS).threats).toEqual({
      1: "red",
      2: "yellow",
      3: "yellow",
    });
    // At 0 decimals 1.4 rounds to 1 (red) and 2.4 to 2 (yellow); 2.6 rounds to 3 (none).
    const coarse = relativeView(frameWith({ 1: 1.4, 2: 2.4, 3: 2.6 }), {
      ...OPTIONS,
      gapDecimals: 0,
    });
    expect(coarse.threats).toEqual({ 1: "red", 2: "yellow" });
  });

  it("has no threats when the option is off, and never for cars ahead", () => {
    const frame = frameWith({ 1: -0.5, 2: 0.5 });
    expect(relativeView(frame, { ...OPTIONS, gapThreat: false }).threats).toEqual({});
    expect(relativeView(frame, OPTIONS).threats).toEqual({ 2: "red" });
  });

  it("gapThreat is null for a car ahead or with an unknown gap", () => {
    const row = relativeView(frameWith({ 1: 0.5 }), OPTIONS).rows[1];
    if (row === undefined) throw new Error("missing row");
    expect(gapThreat(row, -0.5)).toBeNull();
    expect(gapThreat(row, null)).toBeNull();
    expect(gapThreat(row, 0.5)).toBe("red");
  });

  it("is empty without a focus car, before the first frame and when not live", () => {
    expect(ids(frameWith(many, {}, { playerCarIdx: null }))).toEqual([]);
    expect(relativeView(null, OPTIONS).rows).toEqual([]);
    expect(relativeView({ ...frameWith(many), status: "waiting" }, OPTIONS).rows).toEqual([]);
  });

  describe("lap marks", () => {
    const lapped = (lapColours: boolean) => {
      const frame = frameWith({ 1: -1, 2: -0.5, 3: 0.5, 4: 1 });
      const deltas: Record<number, number | null> = { 1: 2, 2: 1, 3: -1, 4: null };
      for (const g of frame.derived.gaps) g.lapDelta = deltas[g.carIdx] ?? 0;
      return Object.fromEntries(
        relativeView(frame, { ...OPTIONS, lapColours }).rows.map((r) => [r.carIdx, r.lapMark]),
      );
    };

    it("marks cars a lap or more ahead and behind, never the focus car", () => {
      expect(lapped(true)).toEqual({ 1: "ahead", 2: "ahead", 0: null, 3: "behind", 4: null });
    });

    it("marks nothing when the option is off", () => {
      expect(lapped(false)).toEqual({ 1: null, 2: null, 0: null, 3: null, 4: null });
    });

    it("maps lap deltas to marks; unknown or same lap is none", () => {
      expect(lapStatus(1)).toBe("ahead");
      expect(lapStatus(3)).toBe("ahead");
      expect(lapStatus(-1)).toBe("behind");
      expect(lapStatus(0)).toBeNull();
      expect(lapStatus(null)).toBeNull();
      expect(lapStatus(undefined)).toBeNull();
      expect(lapStatus(Number.NaN)).toBeNull();
    });
  });

  it("reuses row objects that did not change", () => {
    const first = relativeView(frameWith(many), OPTIONS);
    const second = relativeView(frameWith(many), OPTIONS, first.rows);
    expect(second.rows.every((r, i) => r === first.rows[i])).toBe(true);
  });

  it("passes header and footer ids through and reports the flag colour", () => {
    const frame = fixtureFrame({
      playerCarIdx: 0,
      cars: [{ carIdx: 0 }],
      flags: { yellow: true },
    });
    const view = relativeView(frame, { ...OPTIONS, headerIds: ["air-temp"], footerIds: ["sof"] });
    expect(view.headerIds).toEqual(["air-temp"]);
    expect(view.footerIds).toEqual(["sof"]);
    expect(view.flagColour).toBe("var(--ov-locked-flag-yellow)");
  });
});

describe("relativeView timing", () => {
  it("handles a 60-car frame well inside the budget", () => {
    const gaps: Record<number, number> = {};
    for (let i = 1; i < 60; i++) gaps[i] = (i - 30) * 1.7;
    const frame = frameWith(gaps);
    const run = (): number => {
      const start = performance.now();
      relativeView(frame, OPTIONS);
      return performance.now() - start;
    };
    run();
    const samples = Array.from({ length: 21 }, run).sort((a, b) => a - b);
    const median = samples[10] ?? 0;
    console.log(`relativeView, 60 cars: median ${median.toFixed(3)} ms`);
    // Target 0.5 ms; only fail at 10x.
    expect(median).toBeLessThan(5);
  });
});
