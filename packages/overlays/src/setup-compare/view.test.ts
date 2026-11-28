import type { SetupSide } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { compareView, sampleSetupCompareView, setupCompareView } from "./view";

const side = (name: string, patch: Partial<SetupSide> = {}): SetupSide => ({
  name,
  laps: 5,
  bestLapS: 100.184,
  avgLapS: 100.342,
  sectorsS: [31.421, 41.883, 26.88],
  topSpeedMps: 73.6,
  fuelPerLapL: 2.4,
  ...patch,
});

const ON = { sectors: true };

describe("compareView", () => {
  it("lists best lap, 5-lap average and each sector with active-minus-baseline deltas", () => {
    const v = compareView(
      side("race"),
      side("lowdf", { bestLapS: 99.817, avgLapS: 100.4, sectorsS: [31.244, 41.883, 27] }),
      false,
      ON,
    );
    expect(v.rows.map((r) => [r.label, r.deltaS, r.tone])).toEqual([
      ["Best Lap", -0.367, "gain"],
      ["5-Lap Avg", 0.058, "loss"],
      ["Sector 1", -0.177, "gain"],
      ["Sector 2", 0, null],
      ["Sector 3", 0.12, "loss"],
    ]);
    expect(v.rows[0]?.activeFastest).toBe(true);
    expect(v.rows.slice(1).some((r) => r.activeFastest)).toBe(false);
    expect(v.same).toBe(false);
  });

  it("marks the active best only when it beats the baseline", () => {
    const v = compareView(side("a"), side("b", { bestLapS: 100.3 }), false, ON);
    expect(v.rows[0]?.activeFastest).toBe(false);
    expect(v.rows[0]?.tone).toBe("loss");
  });

  it("has no deltas when the baseline is the active setup", () => {
    const v = compareView(side("a"), side("a"), true, ON);
    expect(v.same).toBe(true);
    expect(v.pinned).toBe(true);
    expect(v.rows.every((r) => r.deltaS === null && r.tone === null && !r.activeFastest)).toBe(
      true,
    );
    expect(v.rows[0]?.baselineS).toBe(100.184);
    expect(v.topSpeedDeltaMps).toBeNull();
    expect(v.fuelDeltaL).toBeNull();
    expect(v.fuelPerLapL).toBe(2.4);
  });

  it("leaves a side without laps empty and hides sectors on request", () => {
    const empty = side("b", {
      laps: 0,
      bestLapS: null,
      avgLapS: null,
      sectorsS: null,
      topSpeedMps: null,
      fuelPerLapL: null,
    });
    const v = compareView(side("a"), empty, false, ON);
    expect(v.rows).toHaveLength(5);
    expect(v.rows.every((r) => r.activeS === null && r.deltaS === null)).toBe(true);
    expect(v.topSpeedDeltaMps).toBeNull();
    expect(v.fuelPerLapL).toBeNull();
    expect(compareView(side("a"), side("b"), false, { sectors: false }).rows).toHaveLength(2);
  });

  it("shows the active layout's sectors and no baseline sectors from another layout", () => {
    const v = compareView(side("a", { sectorsS: [50, 50] }), side("b"), false, ON);
    expect(v.rows.filter((r) => r.id.startsWith("sector"))).toHaveLength(3);
    expect(v.rows[2]?.baselineS).toBeNull();
    expect(v.rows[2]?.activeS).toBe(31.421);
  });

  it("gives top speed and fuel deltas", () => {
    const v = compareView(
      side("a"),
      side("b", { topSpeedMps: 74.5, fuelPerLapL: 2.38 }),
      false,
      ON,
    );
    expect(v.topSpeedDeltaMps).toBeCloseTo(0.9, 9);
    expect(v.fuelDeltaL).toBeCloseTo(-0.02, 9);
  });
});

describe("setupCompareView", () => {
  it("is null without a live frame or a named setup", () => {
    expect(setupCompareView(null, ON)).toBeNull();
    const f = fixtureFrame({ cars: [{ carIdx: 0 }], playerCarIdx: 0 });
    expect(setupCompareView(f, ON)).toBeNull();
    f.derived.setupCompare = { baseline: side("a"), active: side("b"), pinned: false };
    expect(setupCompareView(f, ON)?.activeName).toBe("b");
    expect(setupCompareView({ ...f, status: "waiting" }, ON)).toBeNull();
  });
});

describe("sampleSetupCompareView", () => {
  it("is the design's comparison with three-decimal times", () => {
    const v = sampleSetupCompareView(ON);
    expect([v.baselineName, v.activeName]).toEqual(["spa_race_v1", "spa_lowdf_v2"]);
    expect(v.rows.map((r) => r.deltaS)).toEqual([-0.367, -0.324, -0.177, -0.055, -0.135]);
    expect(v.rows[0]?.activeFastest).toBe(true);
    expect(v.topSpeedDeltaMps! * 3.6).toBeCloseTo(3.4, 6);
    expect(v.fuelDeltaL).toBeCloseTo(-0.02, 9);
  });
});
