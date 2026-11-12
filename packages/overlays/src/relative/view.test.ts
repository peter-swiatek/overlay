import type { Car, DerivedGap, TelemetryFrame } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, fixtureFrame, lapStatus } from "../shared";
import { carStatus, relativeView, type RelativeOptions } from "./view";

const OPTIONS: RelativeOptions = {
  ahead: 3,
  behind: 3,
  hideInPits: false,
  lapColours: true,
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

  it("keeps -0.04 s ahead and +0.04 s behind, and colours neither by gap", () => {
    const view = relativeView(frameWith({ 1: -0.04, 2: 0.04, 3: 1.5 }), OPTIONS);
    expect(view.rows.map((r) => r.carIdx)).toEqual([1, 0, 2, 3]);
    expect(view.rows.map((r) => r.relativeGapS)).toEqual([0, 0, 0, 1.5]);
    expect(view.rows.map((r) => r.status)).toEqual([null, null, null, null]);
    expect(view).not.toHaveProperty("threats");
    expect(view.rows[2]).not.toHaveProperty("threat");
  });

  it("is empty without a focus car, before the first frame and when not live", () => {
    expect(ids(frameWith(many, {}, { playerCarIdx: null }))).toEqual([]);
    expect(relativeView(null, OPTIONS).rows).toEqual([]);
    expect(relativeView({ ...frameWith(many), status: "waiting" }, OPTIONS).rows).toEqual([]);
  });

  describe("car status", () => {
    const statuses = (lapColours: boolean, cars: Record<number, Partial<Car>> = {}) => {
      const frame = frameWith({ 1: -1, 2: -0.5, 3: 0.5, 4: 1, 5: 2 }, cars);
      const deltas: Record<number, number | null> = { 1: 2, 2: 1, 3: -1, 4: null, 5: 0 };
      for (const g of frame.derived.gaps) g.lapDelta = deltas[g.carIdx] ?? 0;
      return Object.fromEntries(
        relativeView(frame, { ...OPTIONS, lapColours }).rows.map((r) => [r.carIdx, r.status]),
      );
    };

    it("marks cars a lap or more ahead and behind, never the focus car", () => {
      expect(statuses(true)).toEqual({
        1: "ahead",
        2: "ahead",
        0: null,
        3: "behind",
        4: null,
        5: null,
      });
    });

    it("marks a car in the pits muted, ahead of its lap status", () => {
      const view = statuses(true, {
        1: { onPitRoad: true },
        3: { inPitStall: true },
        5: { onPitRoad: true },
        0: { onPitRoad: true },
      });
      expect(view).toEqual({ 1: "pit", 2: "ahead", 0: null, 3: "pit", 4: null, 5: "pit" });
    });

    it("marks nothing when the option is off", () => {
      const off = statuses(false, { 1: { onPitRoad: true } });
      expect(off).toEqual({ 1: null, 2: null, 0: null, 3: null, 4: null, 5: null });
    });

    it("carStatus puts pits before lap status", () => {
      const row = relativeView(frameWith({ 1: 0.5 }), OPTIONS).rows[1];
      if (row === undefined) throw new Error("missing row");
      expect(carStatus(row, "ahead")).toBe("ahead");
      expect(carStatus(row, null)).toBeNull();
      expect(carStatus({ ...row, onPitRoad: true }, "behind")).toBe("pit");
      expect(carStatus({ ...row, inPitStall: true }, null)).toBe("pit");
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
