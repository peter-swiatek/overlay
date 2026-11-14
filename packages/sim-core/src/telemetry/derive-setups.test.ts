import { describe, expect, it } from "vitest";
import type { SetupCombo, SetupStatsStore } from "../calc/setups";
import { Deriver } from "./derive";
import { MockSource } from "./mock";

describe("Deriver setup compare", () => {
  it("compares the mock's first setup with the one it changes to after two laps", () => {
    const saved: SetupCombo[] = [];
    const store: SetupStatsStore = { load: () => null, save: (_k, c) => void saved.push(c) };
    const mock = new MockSource();
    const deriver = new Deriver({ setupStats: store });
    let out = deriver.next(mock.step(0.1));
    expect(out.setupCompare?.active.name).toBe("mock_race_v1");
    expect(out.setupCompare?.baseline.name).toBe("mock_race_v1");
    // Lap 4 (the first valid lap on the second setup) ends about 376 s in.
    for (let i = 0; i < 3900; i++) out = deriver.next(mock.step(0.1));
    const cmp = out.setupCompare;
    expect(cmp?.baseline).toMatchObject({ name: "mock_race_v1", laps: 2, bestLapS: 99.8 });
    expect(cmp?.active).toMatchObject({ name: "mock_lowdf_v2", laps: 1, bestLapS: 99.6 });
    expect(cmp?.active.sectorsS).toHaveLength(4);
    expect(cmp?.active.fuelPerLapL).toBeCloseTo(2.4, 1);
    expect(cmp?.active.topSpeedMps).toBeGreaterThan(40);
    // The mock is never written to the store.
    expect(saved).toEqual([]);
  });

  it("pins through setPinSetupBaseline and forgets the session's first setup on reset", () => {
    const mock = new MockSource();
    const deriver = new Deriver();
    deriver.setPinSetupBaseline(false);
    let out = deriver.next(mock.step(0.1));
    for (let i = 0; i < 2000; i++) out = deriver.next(mock.step(0.1));
    expect(out.setupCompare?.active.name).toBe("mock_lowdf_v2");
    deriver.setPinSetupBaseline(true);
    out = deriver.next(mock.step(0.1));
    expect(out.setupCompare?.pinned).toBe(true);
    expect(out.setupCompare?.baseline.name).toBe("mock_lowdf_v2");
  });
});
