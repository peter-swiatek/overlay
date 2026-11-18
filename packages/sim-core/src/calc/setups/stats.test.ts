import { describe, expect, it } from "vitest";
import { addSetupLap, emptySetupCombo, parseSetupCombo, setupKeyOf, setupSide } from "./stats";
import { SETUP_MAX_PER_COMBO, type SetupCombo, type SetupLap } from "./types";

const lap = (lapTimeS: number, patch: Partial<SetupLap> = {}): SetupLap => ({
  lapTimeS,
  sectorTimes: [30, 40, lapTimeS - 70],
  topSpeedMps: 70,
  fuelUsedL: 2.4,
  ...patch,
});

describe("setupKeyOf", () => {
  it("drops .sto, marks a modified setup and has no key for a blank name", () => {
    expect(setupKeyOf({ name: "spa_race_v1.sto", modified: false })).toBe("spa_race_v1");
    expect(setupKeyOf({ name: "spa_race_v1.STO", modified: true })).toBe("spa_race_v1*");
    expect(setupKeyOf({ name: "fixed.sto", modified: false })).toBe("fixed");
    expect(setupKeyOf({ name: " ", modified: false })).toBeNull();
    expect(setupKeyOf(null)).toBeNull();
    expect(setupKeyOf(undefined)).toBeNull();
  });
});

describe("addSetupLap", () => {
  it("rounds and keeps the newest five laps of each list", () => {
    let combo = emptySetupCombo();
    for (let i = 0; i < 7; i++) {
      combo = addSetupLap(combo, "a", lap(100 + i + 0.00049, { topSpeedMps: 70.123 }), `t${i}`);
    }
    const rec = combo.setups["a"]!;
    expect(rec.laps).toBe(7);
    expect(rec.bestLapS).toBe(100);
    expect(rec.recentLapsS).toEqual([106, 105, 104, 103, 102]);
    expect(rec.recentTopSpeedsMps).toEqual([70.12, 70.12, 70.12, 70.12, 70.12]);
    expect(rec.updatedAt).toBe("t6");
  });

  it("skips missing fuel and top speed, and starts the sectors over on a new layout", () => {
    let combo = addSetupLap(emptySetupCombo(), "a", lap(100, { fuelUsedL: null }), "t");
    combo = addSetupLap(
      combo,
      "a",
      lap(101, { topSpeedMps: null, sectorTimes: [29, null, 31] }),
      "t",
    );
    expect(combo.setups["a"]?.recentFuelL).toEqual([2.4]);
    expect(combo.setups["a"]?.recentTopSpeedsMps).toEqual([70]);
    expect(combo.setups["a"]?.bestSectorsS).toEqual([29, 40, 30]);
    combo = addSetupLap(combo, "a", lap(102, { sectorTimes: [50, 52] }), "t");
    expect(combo.setups["a"]?.bestSectorsS).toEqual([50, 52]);
  });

  it("ignores a lap without a time and leaves the input unchanged", () => {
    const combo = emptySetupCombo();
    expect(addSetupLap(combo, "a", lap(0), "t")).toBe(combo);
    addSetupLap(combo, "a", lap(100), "t");
    expect(combo.setups).toEqual({});
  });

  it("keeps at most the setup limit, sparing the baseline and the setup just driven", () => {
    let combo: SetupCombo = { ...emptySetupCombo(), baseline: "s00" };
    for (let i = 0; i <= SETUP_MAX_PER_COMBO + 2; i++) {
      combo = addSetupLap(
        combo,
        `s${String(i).padStart(2, "0")}`,
        lap(100),
        `t${String(i).padStart(2, "0")}`,
      );
    }
    const keys = Object.keys(combo.setups);
    expect(keys).toHaveLength(SETUP_MAX_PER_COMBO);
    expect(keys).toContain("s00");
    expect(keys).toContain(`s${SETUP_MAX_PER_COMBO + 2}`);
    expect(keys).not.toContain("s01");
    expect(combo.baseline).toBe("s00");
  });
});

describe("setupSide", () => {
  it("averages the recent lists and has no numbers without a record", () => {
    const combo = addSetupLap(
      addSetupLap(emptySetupCombo(), "a", lap(100), "t"),
      "a",
      lap(101, { fuelUsedL: 2.2 }),
      "t",
    );
    expect(setupSide("a", combo.setups["a"])).toEqual({
      name: "a",
      laps: 2,
      bestLapS: 100,
      avgLapS: 100.5,
      sectorsS: [30, 40, 30],
      topSpeedMps: 70,
      fuelPerLapL: 2.3,
    });
    expect(setupSide("b", undefined)).toEqual({
      name: "b",
      laps: 0,
      bestLapS: null,
      avgLapS: null,
      sectorsS: null,
      topSpeedMps: null,
      fuelPerLapL: null,
    });
  });
});

describe("parseSetupCombo", () => {
  it("keeps good setups and drops bad ones", () => {
    const combo = parseSetupCombo({
      baseline: "a",
      updatedAt: "t",
      setups: {
        a: {
          laps: 3,
          bestLapS: 100,
          recentLapsS: [100, "x", -1, 101],
          bestSectorsS: [30, null, "y"],
          recentTopSpeedsMps: [70],
          recentFuelL: [2.4, 0],
          updatedAt: "t",
        },
        b: { laps: 0 },
        c: "nope",
        " ": { laps: 1 },
      },
    });
    expect(combo).toEqual({
      baseline: "a",
      updatedAt: "t",
      setups: {
        a: {
          laps: 3,
          bestLapS: 100,
          recentLapsS: [100, 101],
          bestSectorsS: [30, null, null],
          recentTopSpeedsMps: [70],
          recentFuelL: [2.4],
          updatedAt: "t",
        },
      },
    });
    expect(parseSetupCombo(null)).toBeNull();
    expect(parseSetupCombo({ baseline: 3 })).toEqual({ baseline: null, setups: {}, updatedAt: "" });
  });
});
