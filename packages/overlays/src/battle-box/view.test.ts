import { describe, expect, it } from "vitest";
import { battleView, intText, sectorDeltas, type BattleOptions } from "./view";
import { battleFrame } from "./test-support";

const OPTIONS: BattleOptions = {
  livePositions: true,
  gapDecimals: 1,
  lapDecimals: 3,
};

describe("battleView", () => {
  it("is empty without a live frame", () => {
    expect(battleView(null, OPTIONS).rows).toEqual([]);
  });

  it("shows the cars one place ahead and behind in the focus car's class, never another class", () => {
    const v = battleView(battleFrame(), OPTIONS);
    expect(v.rows.map((r) => [r.carIdx, r.role])).toEqual([
      [2, "ahead"],
      [3, "own"],
      [4, "behind"],
    ]);
  });

  it("uses the official class positions when live positions are off", () => {
    const f = battleFrame({
      standings: (entries) =>
        entries.map((e) =>
          e.carIdx === 1
            ? { ...e, classPosition: 2 }
            : e.carIdx === 2
              ? { ...e, classPosition: 1 }
              : e,
        ),
    });
    const v = battleView(f, { ...OPTIONS, livePositions: false });
    expect(v.rows[0]?.carIdx).toBe(1);
  });

  it("leaves out the car ahead for the class leader", () => {
    const f = battleFrame();
    f.state.playerCarIdx = 1;
    f.state.focusCarIdx = 1;
    const v = battleView(f, OPTIONS);
    expect(v.rows.map((r) => r.role)).toEqual(["own", "behind"]);
    expect(v.aheadSectors).toBeNull();
  });

  it("race: gaps at the timing line, ahead negative, own zero, behind positive", () => {
    const v = battleView(battleFrame(), OPTIONS);
    expect(v.rows.map((r) => r.intText)).toEqual(["-2.5", "0.0", "+0.8"]);
    const two = battleView(battleFrame(), { ...OPTIONS, gapDecimals: 2 });
    expect(two.rows.map((r) => r.intText)).toEqual(["-2.46", "0.00", "+0.84"]);
  });

  it("outside races: the best-lap intervals", () => {
    const v = battleView(battleFrame({ type: "practice" }), OPTIONS);
    expect(v.rows.map((r) => r.intText)).toEqual(["-0.3", "0.0", "+0.2"]);
  });

  it("carries no closeness colour on any row", () => {
    const v = battleView(battleFrame(), OPTIONS);
    for (const row of v.rows) expect(row).not.toHaveProperty("threat");
  });

  it("compares your latest sector times with each car's, rounded to 0.01 s", () => {
    const v = battleView(battleFrame(), OPTIONS);
    expect(v.aheadSectors).toEqual([-0.14, 0.06, -0.07]);
    expect(v.behindSectors).toEqual([-0.19, null, -0.1]);
  });

  it("has no sector deltas without sector data", () => {
    const v = battleView(
      battleFrame({ standings: (entries) => entries.map((e) => ({ ...e, sectorTimes: null })) }),
      OPTIONS,
    );
    expect(v.aheadSectors).toBeNull();
    expect(v.behindSectors).toBeNull();
  });

  it("marks a last lap that is the session or class best", () => {
    const f = battleFrame({
      standings: (entries) => entries.map((e) => (e.carIdx === 3 ? { ...e, classBest: true } : e)),
    });
    const car = f.state.cars.find((c) => c.carIdx === 3);
    if (car === undefined) throw new Error("fixture");
    car.bestLapS = car.lastLapS;
    const v = battleView(f, OPTIONS);
    expect(v.rows.map((r) => r.lastFastest)).toEqual([false, true, false]);
  });

  it("keeps unchanged rows' identity", () => {
    const a = battleView(battleFrame(), OPTIONS);
    const b = battleView(battleFrame(), OPTIONS, a.rows);
    expect(b.rows[1]).toBe(a.rows[1]);
  });
});

describe("intText", () => {
  it("signs seconds and laps, dashes unknown", () => {
    expect(intText({ laps: 0, seconds: 1.234 }, "+", 1)).toBe("+1.2");
    expect(intText({ laps: 1, seconds: null }, "-", 1)).toBe("-1L");
    expect(intText({ laps: 0, seconds: null }, "+", 1)).toBe("--");
    expect(intText(null, "+", 1)).toBe("--");
  });
});

describe("sectorDeltas", () => {
  it("takes the length of whichever list exists", () => {
    expect(sectorDeltas(null, [1, 2])).toEqual([null, null]);
    expect(sectorDeltas(undefined, null)).toBeNull();
  });
});
