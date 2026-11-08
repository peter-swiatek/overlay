import type { LapHistory, LapRecord } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import {
  averageLap,
  lapRows,
  lapTimesView,
  SAMPLE_LAP_TIMES_VIEW,
  trendBars,
  type LapTimesOptions,
} from "./view";

const OPTS: LapTimesOptions = { rows: 5, trendLaps: 8 };

function lap(lapNumber: number, lapTimeS: number | null, over: Partial<LapRecord> = {}): LapRecord {
  return {
    lapNumber,
    lapTimeS,
    valid: lapTimeS !== null,
    pit: false,
    trackTempC: 30,
    fuelUsedL: 2.4,
    sectorTimes: null,
    ...over,
  };
}

/** Newest first, from oldest-first times starting at lap `first`. */
function history(first: number, times: (number | null)[]): LapRecord[] {
  return times.map((t, i) => lap(first + i, t)).reverse();
}

describe("lapRows", () => {
  it("lists the newest laps first with the delta to the lap before", () => {
    // The design: 1:40.15 then 1:40.00 is -0.15.
    const rows = lapRows(history(13, [99.82, 100.15, 100.0]), 13, 5);
    expect(rows.map((r) => [r.lapNumber, r.deltaS, r.deltaTone])).toEqual([
      [15, -0.15, "gain"],
      [14, 0.33, "loss"],
      [13, null, null],
    ]);
    expect(rows.map((r) => r.best)).toEqual([false, false, true]);
  });

  it("shows at most the rows asked for", () => {
    expect(lapRows(history(1, [100, 101, 102, 103]), null, 2).map((r) => r.lapNumber)).toEqual([
      4, 3,
    ]);
  });

  it("does not colour a delta against or of a lap that does not count", () => {
    const laps = history(1, [100, 130, 100.5]);
    laps[1] = { ...laps[1]!, valid: false, pit: true };
    const rows = lapRows(laps, 1, 5);
    expect(rows[0]).toMatchObject({ deltaS: -29.5, deltaTone: null });
    expect(rows[1]).toMatchObject({ deltaS: 30, deltaTone: null, valid: false, pit: true });
  });

  it("has no delta across a gap in the lap numbers or without a time", () => {
    const laps = [lap(5, 100), lap(3, 101)];
    expect(lapRows(laps, null, 5)[0]?.deltaS).toBeNull();
    expect(lapRows(history(1, [null, 100]), null, 5)[0]?.deltaS).toBeNull();
  });

  it("leaves a rounded-to-zero delta uncoloured", () => {
    expect(lapRows(history(1, [100, 100.004]), null, 5)[0]).toMatchObject({
      deltaS: 0,
      deltaTone: null,
    });
  });
});

describe("trendBars", () => {
  it("colours each lap against the lap before it, the best purple, oldest first", () => {
    // The design's laps 7..15; the window is laps 8..15.
    const laps = history(7, [100.3, 100.42, 100.28, 100.18, 100.35, 100.22, 99.82, 100.15, 100.0]);
    const bars = trendBars(laps, 13, 8);
    expect(bars.map((b) => [b.lapNumber, b.tone])).toEqual([
      [8, "slower"],
      [9, "faster"],
      [10, "faster"],
      [11, "slower"],
      [12, "faster"],
      [13, "best"],
      [14, "slower"],
      [15, "faster"],
    ]);
    // Faster is taller: the best fills the area, the slowest is the shortest.
    expect(bars.find((b) => b.lapNumber === 13)?.heightPct).toBe(100);
    expect(Math.min(...bars.map((b) => b.heightPct))).toBe(bars[0]?.heightPct);
    expect(bars[0]?.heightPct).toBe(60);
  });

  it("does not exaggerate a tiny spread", () => {
    const bars = trendBars(history(1, [100, 100.06]), null, 8);
    expect(bars.map((b) => b.heightPct)).toEqual([100, 96]);
  });

  it("draws laps that do not count as short muted bars and leaves them out of the scale", () => {
    const laps = history(1, [100, 140, 100.6]);
    laps[1] = { ...laps[1]!, valid: false };
    const bars = trendBars(laps, 1, 8);
    expect(bars.map((b) => [b.tone, b.heightPct])).toEqual([
      ["best", 100],
      ["invalid", 35],
      ["none", 60],
    ]);
  });

  it("is empty without laps", () => {
    expect(trendBars([], null, 8)).toEqual([]);
  });
});

describe("averageLap", () => {
  it("averages the last five valid laps", () => {
    const laps = history(1, [90, 100, 100, 100, 100, 105]);
    laps[0] = { ...laps[0]!, valid: false };
    expect(averageLap(laps)).toBeCloseTo((90 + 400) / 5, 9);
    expect(averageLap([])).toBeNull();
  });
});

describe("lapTimesView", () => {
  const laps: LapHistory = {
    carIdx: 2,
    laps: history(1, [100.3, 99.8, 99.5]),
    bestLapS: 99.5,
    bestLapNumber: 3,
    optimalLapS: 99.2,
  };
  const frame = () => {
    const f = fixtureFrame({
      cars: [{ carIdx: 2, carNumber: "7", driverName: "Max Example" }],
      playerCarIdx: 2,
      standings: [{ carIdx: 2, stintLaps: 3 }],
    });
    f.derived.laps = laps;
    return f;
  };

  it("names the focus car and its stint and lists its laps", () => {
    const view = lapTimesView(frame(), OPTS)!;
    expect(view).toMatchObject({
      carNumber: "7",
      driverName: "Max Example",
      stintLaps: 3,
      bestLapS: 99.5,
      optimalLapS: 99.2,
    });
    expect(view.rows.map((r) => r.lapNumber)).toEqual([3, 2, 1]);
    expect(view.trend.map((b) => b.lapNumber)).toEqual([1, 2, 3]);
    expect(view.avgLapS).toBeCloseTo((100.3 + 99.8 + 99.5) / 3, 9);
  });

  it("has an empty list before the first lap", () => {
    const f = frame();
    f.derived.laps = null;
    const view = lapTimesView(f, OPTS)!;
    expect(view.carNumber).toBe("7");
    expect(view.rows).toEqual([]);
    expect(view.bestLapS).toBeNull();
  });

  it("is null without a live frame or a focus car", () => {
    expect(lapTimesView(null, OPTS)).toBeNull();
    const f = frame();
    f.derived.laps = null;
    f.state.playerCarIdx = null;
    f.state.focusCarIdx = null;
    expect(lapTimesView(f, OPTS)).toBeNull();
  });
});

describe("SAMPLE_LAP_TIMES_VIEW", () => {
  it("matches the design hand-off", () => {
    const v = SAMPLE_LAP_TIMES_VIEW;
    expect(v.rows.map((r) => r.lapNumber)).toEqual([15, 14, 13, 12, 11]);
    expect(v.rows.map((r) => r.deltaS)).toEqual([-0.15, 0.33, -0.4, -0.13, 0.17]);
    expect(v.trend.map((b) => b.tone)).toEqual([
      "slower",
      "faster",
      "faster",
      "slower",
      "faster",
      "best",
      "slower",
      "faster",
    ]);
    expect(v.avgLapS).toBeCloseTo(100.108, 3);
  });
});
