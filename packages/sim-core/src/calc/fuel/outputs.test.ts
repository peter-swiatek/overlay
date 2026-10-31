import { describe, expect, it } from "vitest";
import { FuelTracker, computeLapTargets, computeRefuel, lapsPerTank } from "./index";
import { FakeDriver, feed } from "./testHelpers";

/** Drives whole laps in which lap n (1-based) uses exactly `uses[n - 1]` litres. */
function driveLaps(tracker: FuelTracker, uses: readonly number[]): void {
  const d = new FakeDriver(500, 0);
  tracker.update(d.sample());
  let fuel = 500;
  for (const use of uses) {
    for (let i = 0; i < 10; i++) {
      const sample = d.step();
      fuel -= use / 10;
      tracker.update({ ...sample, fuelL: fuel });
    }
  }
}

describe("recent averages and recent laps", () => {
  it("with 3 valid laps both averages cover all three", () => {
    const t = new FuelTracker();
    driveLaps(t, [2, 3, 4]);
    const out = t.snapshot({ lapsToGo: 10 });
    expect(out.validLapCount).toBe(3);
    expect(out.fuelAvg5Lap).toBeCloseTo(3, 6);
    expect(out.fuelAvg10Lap).toBeCloseTo(3, 6);
    expect(out.recentLaps.map((l) => l.used.toFixed(1))).toEqual(["4.0", "3.0", "2.0"]);
    expect(out.recentLaps.map((l) => l.lapNumber)).toEqual([3, 2, 1]);
  });

  it("with 5 valid laps the 5 lap average equals the session average", () => {
    const t = new FuelTracker();
    driveLaps(t, [1, 2, 3, 4, 5]);
    const out = t.snapshot({ lapsToGo: 10 });
    expect(out.fuelAvg5Lap).toBeCloseTo(3, 6);
    expect(out.fuelAvg10Lap).toBeCloseTo(3, 6);
  });

  it("with 7 valid laps the 5 lap average uses the newest five", () => {
    const t = new FuelTracker();
    driveLaps(t, [10, 10, 1, 2, 3, 4, 5]);
    const out = t.snapshot({ lapsToGo: 10 });
    expect(out.fuelAvg5Lap).toBeCloseTo(3, 6);
    expect(out.fuelAvg10Lap).toBeCloseTo(35 / 7, 6);
    expect(out.fuelAvgLap).toBeCloseTo(35 / 7, 6);
    expect(out.recentLaps).toHaveLength(7);
  });

  it("with 12 valid laps recentLaps stops at ten and the 10 lap average drops the oldest two", () => {
    const t = new FuelTracker();
    driveLaps(t, [20, 20, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
    const out = t.snapshot({ lapsToGo: 10 });
    expect(out.validLapCount).toBe(12);
    expect(out.recentLaps).toHaveLength(10);
    expect(out.recentLaps[0]?.used).toBeCloseTo(2, 6);
    expect(out.recentLaps[9]?.used).toBeCloseTo(1, 6);
    expect(out.fuelAvg10Lap).toBeCloseTo(1.5, 6);
    expect(out.fuelAvg5Lap).toBeCloseTo(2, 6);
  });

  it("is null with no valid lap", () => {
    const t = new FuelTracker();
    t.update(new FakeDriver(50, 2).sample());
    const out = t.snapshot({ lapsToGo: 4 });
    expect(out.fuelAvg5Lap).toBeNull();
    expect(out.fuelAvg10Lap).toBeNull();
    expect(out.recentLaps).toEqual([]);
    expect(out.fuelPerHour).toBeNull();
    expect(out.lapsToGo).toBe(4);
  });

  it("leaves invalid laps out", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(100, 2);
    feed(t, d, 1);
    d.isPaceLap = true;
    feed(t, d, 1);
    d.isPaceLap = false;
    feed(t, d, 2);
    const out = t.snapshot({ lapsToGo: null });
    expect(t.lapRecords.some((l) => l.reason === "paceLap")).toBe(true);
    expect(out.recentLaps).toHaveLength(out.validLapCount);
    expect(out.validLapCount).toBeLessThan(t.lapRecords.length);
    expect(out.lapsToGo).toBeNull();
  });
});

describe("lap times and fuel per hour", () => {
  it("measures lap time between the start and end crossings", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(100, 2), 3);
    const out = t.snapshot({ lapsToGo: null });
    expect(out.recentLaps).toHaveLength(3);
    for (const lap of out.recentLaps) expect(lap.lapTimeS).toBeCloseTo(10, 6);
  });

  it("fuel per hour is total use over total lap time", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(100, 2), 3);
    // 2 L every 10 s
    expect(t.snapshot({ lapsToGo: null }).fuelPerHour).toBeCloseTo(720, 6);
  });

  it("lap time and stint time are null when the session time is unknown", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(100, 2);
    t.update({ ...d.sample(), sessionTimeS: Number.NaN });
    for (let i = 0; i < 25; i++) t.update({ ...d.step(), sessionTimeS: Number.NaN });
    const out = t.snapshot({ lapsToGo: null });
    expect(out.validLapCount).toBeGreaterThan(0);
    expect(out.recentLaps[0]?.lapTimeS).toBeNull();
    expect(out.fuelPerHour).toBeNull();
    expect(out.stintTimeS).toBeNull();
  });
});

describe("stints", () => {
  it("counts laps and time since the session start", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(100, 2), 3);
    const out = t.snapshot({ lapsToGo: null });
    expect(out.stintLaps).toBe(3);
    expect(out.stintTimeS).toBeCloseTo(30, 6);
  });

  it("a refuel starts a new stint", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(50, 2);
    feed(t, d, 3);
    d.fuelL += 30;
    feed(t, d, 2);
    const out = t.snapshot({ lapsToGo: null });
    expect(out.stintLaps).toBe(2);
    expect(out.stintTimeS).toBeCloseTo(20, 6);
  });

  it("is available before the first valid lap", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(50, 2);
    t.update(d.sample());
    for (let i = 0; i < 4; i++) t.update(d.step());
    const out = t.snapshot({ lapsToGo: null });
    expect(out.stintLaps).toBe(0);
    expect(out.stintTimeS).toBeCloseTo(4, 6);
  });
});

describe("computeRefuel", () => {
  const base = {
    lapsToGo: 10,
    perLap: 2,
    currentFuel: 5,
    safetyMarginLaps: 0,
    tankCapacity: null,
  };
  it("is zero with enough fuel", () => {
    expect(computeRefuel({ ...base, currentFuel: 25 })).toBe(0);
  });
  it("adds the shortfall", () => {
    expect(computeRefuel(base)).toBeCloseTo(15, 9);
  });
  it("adds the safety margin laps", () => {
    expect(computeRefuel({ ...base, safetyMarginLaps: 1.5 })).toBeCloseTo(18, 9);
  });
  it("caps at the tank capacity, not at the room left now", () => {
    // 15 L short; the stop can take at most a full tank, however much fuel is on board today.
    expect(computeRefuel({ ...base, tankCapacity: 12 })).toBeCloseTo(12, 9);
    expect(computeRefuel({ ...base, currentFuel: 14, tankCapacity: 12 })).toBeCloseTo(6, 9);
    expect(computeRefuel({ ...base, currentFuel: 9, tankCapacity: 12 })).toBeCloseTo(11, 9);
  });
  it("is null when an input is missing or use is not positive", () => {
    expect(computeRefuel({ ...base, lapsToGo: null })).toBeNull();
    expect(computeRefuel({ ...base, perLap: null })).toBeNull();
    expect(computeRefuel({ ...base, currentFuel: null })).toBeNull();
    expect(computeRefuel({ ...base, perLap: 0 })).toBeNull();
  });
});

describe("computeLapTargets", () => {
  it("matches the reference worked example: 2.5 L/lap, fuel for 3 laps, +1 lap", () => {
    const [one] = computeLapTargets(7.5, 3, [1]);
    expect(one?.laps).toBe(4);
    expect(one?.perLap).toBeCloseTo(1.875, 6);
  });
  it("gives a target per extra lap count", () => {
    const out = computeLapTargets(7.5, 3.4, [1, 2]);
    expect(out.map((t) => t.laps)).toEqual([4, 5]);
    expect(out.map((t) => t.extraLaps)).toEqual([1, 2]);
    expect(out[1]?.perLap).toBeCloseTo(1.5, 6);
  });
  it("skips targets of zero laps", () => {
    expect(computeLapTargets(1, 0.5, [0, 1])).toEqual([{ extraLaps: 1, laps: 1, perLap: 1 }]);
  });
});

describe("lapsPerTank", () => {
  it("divides capacity by use", () => {
    expect(lapsPerTank(100, 2.5)).toBe(40);
  });
  it("is null when unknown", () => {
    expect(lapsPerTank(null, 2)).toBeNull();
    expect(lapsPerTank(100, null)).toBeNull();
    expect(lapsPerTank(100, 0)).toBeNull();
    expect(lapsPerTank(0, 2)).toBeNull();
  });
});
