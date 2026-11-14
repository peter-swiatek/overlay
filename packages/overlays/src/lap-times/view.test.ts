import type { LapHistory, LapRecord } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import {
  averageLap,
  lapRows,
  lapTimesView,
  SAMPLE_LAP_TIMES_VIEW,
  type LapTimesOptions,
} from "./view";

const OPTS: LapTimesOptions = { rows: 5 };

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
  it("gives each lap's delta to the session best before it, newest first", () => {
    // 1:40.15 (best), 1:40.00 (new best), 1:40.30, 1:39.82 (new best).
    const rows = lapRows(history(12, [100.15, 100.0, 100.3, 99.82]), 15, 5, 99.82);
    expect(rows.map((r) => [r.lapNumber, r.deltaS, r.deltaTone])).toEqual([
      [15, -0.18, "gain"],
      [14, 0.3, "loss"],
      [13, -0.15, "gain"],
      [12, null, null],
    ]);
    expect(rows.map((r) => r.best)).toEqual([true, false, false, false]);
  });

  it("uses an older overall best that has left the kept history", () => {
    const rows = lapRows(history(20, [100.5]), 3, 5, 99.9);
    expect(rows[0]).toMatchObject({ deltaS: 0.6, deltaTone: "loss" });
  });

  it("shows at most the rows asked for", () => {
    expect(lapRows(history(1, [100, 101, 102, 103]), null, 2).map((r) => r.lapNumber)).toEqual([
      4, 3,
    ]);
  });

  it("ignores laps that do not count as a best, and leaves their own delta uncoloured", () => {
    const laps = history(1, [100, 90, 100.5]);
    laps[1] = { ...laps[1]!, valid: false, pit: true };
    const rows = lapRows(laps, 1, 5, 100);
    expect(rows[0]).toMatchObject({ deltaS: 0.5, deltaTone: "loss" });
    expect(rows[1]).toMatchObject({ deltaS: -10, deltaTone: null, valid: false, pit: true });
  });

  it("has no delta without a time or an earlier best", () => {
    expect(lapRows(history(1, [100]), 1, 5, 100)[0]?.deltaS).toBeNull();
    expect(lapRows(history(1, [100, null]), 1, 5, 100)[0]?.deltaS).toBeNull();
  });

  it("leaves a rounded-to-zero delta uncoloured", () => {
    expect(lapRows(history(1, [100, 100.004]), null, 5)[0]).toMatchObject({
      deltaS: 0,
      deltaTone: null,
    });
  });
});

describe("averageLap", () => {
  it("averages the last five valid laps", () => {
    const laps = history(1, [90, 100, 100, 100, 100, 105]);
    laps[0] = { ...laps[0]!, valid: false };
    expect(averageLap(laps)).toBeCloseTo((90 + 400) / 5, 9);
    expect(averageLap([])).toBeNull();
  });

  it("averages up to ten valid laps for the long average", () => {
    const laps = history(1, [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
    // Newest first: the ten newest are 111 down to 102.
    expect(averageLap(laps, 10)).toBeCloseTo(106.5, 9);
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
    expect(view.avgLapS).toBeCloseTo((100.3 + 99.8 + 99.5) / 3, 9);
    expect(view.avg10LapS).toBeCloseTo((100.3 + 99.8 + 99.5) / 3, 9);
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
    expect(v.rows.map((r) => r.deltaS)).toEqual([0.18, 0.33, -0.36, 0.04, 0.17]);
    expect(v.avgLapS).toBeCloseTo(100.108, 3);
  });
});
