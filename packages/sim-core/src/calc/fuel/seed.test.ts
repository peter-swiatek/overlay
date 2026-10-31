import { describe, expect, it } from "vitest";
import { FuelTracker, type SeedLap } from "./index";
import { FakeDriver, feed } from "./testHelpers";

const seed = (...used: number[]): SeedLap[] => used.map((u) => ({ used: u, lapTimeS: 90 }));
const ctx = { lapsToGo: 10, tankCapacityL: 30 };

describe("FuelTracker seed", () => {
  it("uses the seed for averages, max and pit window before any own lap", () => {
    const t = new FuelTracker();
    t.seed(seed(2, 3, 4));
    const d = new FakeDriver(20, 2);
    t.update(d.sample());
    const out = t.snapshot(ctx);
    expect(out.fuelAvgLap).toBeCloseTo(3, 9);
    expect(out.fuelMaxLap).toBe(4);
    expect(out.fuelAvg5Lap).toBeCloseTo(3, 9);
    expect(out.fuelAvg10Lap).toBeCloseTo(3, 9);
    expect(out.lapsRemainingAvg).toBeCloseTo(20 / 3, 9);
    expect(out.lapsRemainingConservative).toBeCloseTo(5, 9);
    expect(out.plusOneLapTarget).not.toBeNull();
    expect(out.fuelSavingNeeded).not.toBeNull();
    expect(out.fuelDelta).toBeCloseTo(20 - 10 * 3, 9);
    expect(out.pitWindow).not.toBeNull();
    // This session's own figures stay empty.
    expect(out.validLapCount).toBe(0);
    expect(out.recentLaps).toEqual([]);
    expect(out.fuelLastLap).toBeNull();
    expect(out.fuelPerHour).toBeNull();
  });

  it("a single seed lap is not enough for the two-lap gates", () => {
    const t = new FuelTracker();
    t.seed(seed(3));
    t.update(new FakeDriver(20, 2).sample());
    const out = t.snapshot(ctx);
    expect(out.fuelAvgLap).toBe(3);
    expect(out.fuelDelta).toBeNull();
    expect(out.pitWindow).toBeNull();
  });

  it("an own lap joins the seed", () => {
    const t = new FuelTracker();
    t.seed(seed(3, 3));
    feed(t, new FakeDriver(20, 2), 1);
    const out = t.snapshot(ctx);
    expect(out.validLapCount).toBe(1);
    expect(out.fuelAvgLap).toBeCloseTo((3 + 3 + 2) / 3, 9);
    expect(out.fuelMaxLap).toBe(3);
    expect(out.fuelLastLap).toBeCloseTo(2, 9);
    expect(out.recentLaps).toHaveLength(1);
    expect(out.fuelDelta).not.toBeNull();
  });

  it("is ignored from the second own valid lap on", () => {
    const seeded = new FuelTracker();
    seeded.seed(seed(9, 9, 9));
    const plain = new FuelTracker();
    const a = new FakeDriver(30, 2);
    const b = new FakeDriver(30, 2);
    feed(seeded, a, 2);
    feed(plain, b, 2);
    expect(seeded.snapshot(ctx)).toEqual(plain.snapshot(ctx));
    expect(seeded.snapshot({ lapsToGo: 10 })).toEqual(plain.snapshot({ lapsToGo: 10 }));
  });

  it("ignores seed laps outside the tracker's limits", () => {
    const t = new FuelTracker();
    t.seed(seed(0.1, 2, 80, Number.NaN));
    t.update(new FakeDriver(20, 2).sample());
    const out = t.snapshot(ctx);
    expect(out.fuelAvgLap).toBe(2);
    expect(out.fuelMaxLap).toBe(2);
  });

  it("uses the limits of a tracker with its own limits", () => {
    const t = new FuelTracker({ minLapUse: 5, maxLapUse: 20 });
    t.seed(seed(2, 10, 30));
    t.update(new FakeDriver(100, 2).sample());
    expect(t.snapshot(ctx).fuelAvgLap).toBe(10);
  });

  it("uses at most the newest 10 seed laps", () => {
    const t = new FuelTracker();
    t.seed(seed(40, 40, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2));
    t.update(new FakeDriver(20, 2).sample());
    expect(t.snapshot(ctx).fuelAvg10Lap).toBe(2);
  });

  it("takes the max over the last 5 of the seed and own laps", () => {
    const t = new FuelTracker();
    t.seed(seed(9, 2, 2, 2, 2));
    feed(t, new FakeDriver(20, 2), 1);
    expect(t.snapshot(ctx).fuelMaxLap).toBe(2);
  });

  it("leaves the tank estimate on the own average", () => {
    const t = new FuelTracker();
    t.seed(seed(9));
    t.update(new FakeDriver(20, 2).sample());
    expect(t.snapshot({ lapsToGo: 10 }).tankCapacityL).toBeNull();
    const u = new FuelTracker();
    u.seed(seed(9, 9));
    feed(u, new FakeDriver(12.5, 2.5), 1);
    expect(u.snapshot({ lapsToGo: 10 }).tankCapacityL).toBeCloseTo(12.5, 6);
  });

  it("seed([]) clears", () => {
    const t = new FuelTracker();
    t.seed(seed(3, 3));
    t.seed([]);
    t.update(new FakeDriver(20, 2).sample());
    expect(t.snapshot(ctx).fuelAvgLap).toBeNull();
  });

  it("keeps stint fields on the session", () => {
    const seeded = new FuelTracker();
    seeded.seed(seed(3, 3));
    const plain = new FuelTracker();
    feed(seeded, new FakeDriver(20, 2), 1);
    feed(plain, new FakeDriver(20, 2), 1);
    const a = seeded.snapshot(ctx);
    const b = plain.snapshot(ctx);
    expect(a.stintLaps).toBe(b.stintLaps);
    expect(a.stintTimeS).toBe(b.stintTimeS);
    expect(a.recentLaps).toEqual(b.recentLaps);
    expect(a.validLapCount).toBe(b.validLapCount);
    expect(a.fuelPerHour).toBe(b.fuelPerHour);
  });
});
