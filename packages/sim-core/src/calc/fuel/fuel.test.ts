import { describe, expect, it } from "vitest";
import {
  FuelTracker,
  effectiveFuelAvg,
  estimateRaceLapsRemaining,
  type FuelInvalidReason,
} from "./index";
import { FakeDriver, feed } from "./testHelpers";

describe("The reference doc example", () => {
  it("2.5 L/lap with fuel for 3 laps targets 1.875 L/lap to make 4", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(12.5, 2.5), 2);
    const out = t.snapshot({ lapsToGo: 10 });
    expect(out.fuelAvgLap).toBeCloseTo(2.5, 6);
    expect(out.fuelLastLap).toBeCloseTo(2.5, 6);
    expect(out.fuelMaxLap).toBeCloseTo(2.5, 6);
    expect(out.lapsRemainingAvg).toBeCloseTo(3, 6);
    expect(out.lapsRemainingConservative).toBeCloseTo(3, 6);
    expect(out.plusOneLapTarget).toBeCloseTo(1.875, 3);
    expect(out.fuelSavingNeeded).toBeCloseTo(0.625, 3);
    expect(out.fuelDelta).toBeCloseTo(7.5 - 10 * 2.5, 6);
  });

  it("pit window uses the real capacity when given", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(12.5, 2.5), 2);
    const out = t.snapshot({ lapsToGo: 10, tankCapacityL: 15 });
    // total 12 laps, 6 laps per tank: start max(2, ceil(12 - 6)), end floor(2 + 3 - 1)
    expect(out.pitWindow).toEqual({ start: 6, end: 4 });
    expect(out.tankCapacityL).toBe(15);
  });

  it("falls back to the reference tank estimate", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(12.5, 2.5), 2);
    expect(t.snapshot({ lapsToGo: 10 }).tankCapacityL).toBeCloseTo(12.5, 6);
  });
});

describe("nulls before enough laps", () => {
  it("everything is null before the first valid lap", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(20, 2);
    t.update(d.sample());
    for (let i = 0; i < 5; i++) t.update(d.step());
    const out = t.snapshot({ lapsToGo: 5 });
    expect(out.fuelAvgLap).toBeNull();
    expect(out.lapsRemainingAvg).toBeNull();
    expect(out.plusOneLapTarget).toBeNull();
    expect(out.pitWindow).toBeNull();
    expect(out.fuelDelta).toBeNull();
  });

  it("pit window and fuel delta need two valid laps, the rest needs one", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(20, 2), 1);
    const out = t.snapshot({ lapsToGo: 5, tankCapacityL: 20 });
    expect(out.fuelAvgLap).toBeCloseTo(2, 6);
    expect(out.plusOneLapTarget).not.toBeNull();
    expect(out.pitWindow).toBeNull();
    expect(out.fuelDelta).toBeNull();
  });

  it("fuel delta and pit window need the caller's lapsToGo", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(20, 2), 2);
    const out = t.snapshot({ lapsToGo: null });
    expect(out.fuelDelta).toBeNull();
    expect(out.pitWindow).toBeNull();
    expect(out.fuelAvgLap).not.toBeNull();
  });
});

/** Runs one lap with the given burn, continuing from `from`'s fuel and counter. */
function lapWith(
  t: FuelTracker,
  from: FakeDriver,
  burn: number,
  prepare?: (d: FakeDriver) => void,
): FakeDriver {
  const d = new FakeDriver(from.fuelL, burn);
  d.lap = from.lap;
  d.sessionTimeS = from.sessionTimeS;
  prepare?.(d);
  for (let i = 0; i < 10; i++) t.update(d.step());
  return d;
}

describe("fuelMaxLap", () => {
  it("is the max of the last 5 valid laps", () => {
    const t = new FuelTracker();
    let d = new FakeDriver(100, 5);
    feed(t, d, 1); // 5 L, falls out of the window below
    for (const burn of [2, 2, 2, 2, 3]) d = lapWith(t, d, burn);
    const out = t.snapshot({ lapsToGo: 3 });
    expect(out.fuelMaxLap).toBeCloseTo(3, 6);
    expect(out.fuelAvgLap).toBeCloseTo((5 + 2 * 4 + 3) / 6, 6);
    // Another low lap pushes the 3 out of neither window; five more would.
    for (let i = 0; i < 5; i++) d = lapWith(t, d, 2);
    expect(t.snapshot({ lapsToGo: 3 }).fuelMaxLap).toBeCloseTo(2, 6);
  });
});

describe("invalid laps", () => {
  // Lap 1 is clean; the rule is exercised on lap 2.
  const cases: [FuelInvalidReason, number, (d: FakeDriver) => void, (d: FakeDriver) => void][] = [
    ["partial", 0.4, () => {}, () => {}],
    ["dataError", 60, () => {}, () => {}],
    ["paceLap", 2, () => {}, (d) => void (d.isPaceLap = true)],
    ["refuel", 2, () => {}, (d) => void (d.fuelL += 5)],
  ];

  it.each(cases)("%s", (reason, burn, _unused, prepare) => {
    const t = new FuelTracker();
    const first = new FakeDriver(200, 2);
    feed(t, first, 1);
    const d = new FakeDriver(first.fuelL, burn);
    d.lap = first.lap;
    d.sessionTimeS = first.sessionTimeS;
    for (let i = 0; i < 10; i++) {
      if (i === 3) {
        prepare(d);
        t.update(d.sample());
      }
      t.update(d.step());
    }
    expect(t.lapRecords).toHaveLength(2);
    expect(t.lapRecords[0]?.valid).toBe(true);
    expect(t.lapRecords[1]?.valid).toBe(false);
    expect(t.lapRecords[1]?.reason).toBe(reason);
    expect(t.snapshot({ lapsToGo: 3 }).validLapCount).toBe(1);
  });

  it("small fill while parked in the stall counts as refuel", () => {
    const t = new FuelTracker();
    const first = new FakeDriver(200, 2);
    feed(t, first, 1);
    const d = new FakeDriver(first.fuelL, 2);
    d.lap = first.lap;
    for (let i = 0; i < 4; i++) t.update(d.step());
    d.inPitStall = true;
    d.fuelL += 0.5;
    t.update(d.sample());
    d.inPitStall = false;
    for (let i = 0; i < 6; i++) t.update(d.step());
    expect(t.lapRecords[1]?.reason).toBe("refuel");
  });

  it("a lap that started on pit road is an outlap", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(50, 2);
    t.update(d.sample());
    d.onPitRoad = true; // still on pit road when the line is crossed
    for (let i = 0; i < 10; i++) t.update(d.step());
    d.onPitRoad = false;
    for (let i = 0; i < 10; i++) t.update(d.step());
    expect(t.lapRecords.map((l) => l.reason)).toEqual([null, "outlap"]);
  });

  it("starting mid-lap voids the first lap", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(50, 2);
    d.pct = 0.5;
    t.update(d.sample());
    for (let i = 0; i < 5; i++) t.update(d.step());
    expect(t.lapRecords[0]?.reason).toBe("unknownStart");
  });

  it("a session change discards history and voids the lap in progress", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(50, 2);
    feed(t, d, 2);
    d.sessionNum = 1;
    d.lap = 0;
    d.pct = 0;
    t.update(d.sample());
    expect(t.lapRecords).toHaveLength(0);
    for (let i = 0; i < 10; i++) t.update(d.step());
    expect(t.lapRecords.map((l) => l.reason)).toEqual(["sessionChange"]);
    expect(t.snapshot({ lapsToGo: 1 }).fuelAvgLap).toBeNull();
  });

  it("a lap counter decrease voids the lap but keeps history", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(50, 2);
    feed(t, d, 3);
    d.lap = 0;
    d.pct = 0.5;
    t.update(d.sample());
    for (let i = 0; i < 5; i++) t.update(d.step());
    expect(t.lapRecords.map((l) => l.reason)).toEqual([null, null, null, "sessionChange"]);
    expect(t.snapshot({ lapsToGo: 1 }).validLapCount).toBe(3);
  });
});

describe("S/F crossing detection", () => {
  it("counts each lap once when pct wraps before the counter", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(50, 2), 3, true);
    expect(t.lapRecords.filter((l) => l.valid)).toHaveLength(3);
    expect(t.snapshot({ lapsToGo: 1 }).fuelAvgLap).toBeCloseTo(2, 6);
  });

  it("counts each lap once when the counter ticks before pct wraps", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(50, 2);
    t.update(d.sample());
    for (let lap = 0; lap < 3; lap++) {
      for (let i = 0; i < 9; i++) t.update(d.step());
      // Last step of the lap: counter ticks while pct is still before the line.
      d.sessionTimeS += 1;
      d.fuelL -= 0.2;
      d.pct = 0.99;
      d.lap += 1;
      t.update(d.sample());
      d.sessionTimeS += 1;
      d.pct = 0.005; // wrap arrives a tick later
      t.update(d.sample());
      d.pct = 0;
    }
    expect(t.lapRecords).toHaveLength(3);
    expect(t.lapRecords.every((l) => l.valid)).toBe(true);
  });
});

describe("tank capacity", () => {
  it("keeps the last estimate after the first refuel", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(30, 2);
    feed(t, d, 3);
    expect(t.snapshot({ lapsToGo: 20 }).tankCapacityL).toBeCloseTo(30, 6);
    d.fuelL += 20;
    t.update(d.sample());
    for (let i = 0; i < 10; i++) t.update(d.step());
    // Another clean lap, then the estimate must still be the pre-refuel one.
    for (let i = 0; i < 10; i++) t.update(d.step());
    expect(t.lapRecords[3]?.reason).toBe("refuel");
    expect(t.snapshot({ lapsToGo: 15 }).tankCapacityL).toBeCloseTo(30, 6);
  });

  it("prefers the caller's capacity", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(30, 2), 2);
    expect(t.snapshot({ lapsToGo: 5, tankCapacityL: 80 }).tankCapacityL).toBe(80);
  });
});

describe("estimateRaceLapsRemaining", () => {
  it("finishes the lap in progress after the clock hits zero", () => {
    // 0.5 lap to the line takes 50 s, 550 s left after that is 5.5 laps, so 6 more
    expect(estimateRaceLapsRemaining(600, 100, 0.5)).toBeCloseTo(6.5, 9);
  });
  it("is just the lap remainder when the clock ends before the line", () => {
    expect(estimateRaceLapsRemaining(10, 100, 0.5)).toBeCloseTo(0.5, 9);
    expect(estimateRaceLapsRemaining(0, 100, 0.25)).toBeCloseTo(0.75, 9);
  });
  it("is null without a lap time", () => {
    expect(estimateRaceLapsRemaining(100, 0, 0.5)).toBeNull();
  });
});

describe("effectiveFuelAvg", () => {
  it("uses the own average without teammates", () => {
    expect(effectiveFuelAvg(2.5, [])).toBe(2.5);
    expect(effectiveFuelAvg(2.5, [null])).toBe(2.5);
  });
  it("averages teammates when connected", () => {
    expect(effectiveFuelAvg(2.5, [2, 3, 4])).toBe(3);
  });
  it("feeds the snapshot via fuelAvgOverride", () => {
    const t = new FuelTracker();
    feed(t, new FakeDriver(20, 2), 2);
    const out = t.snapshot({ lapsToGo: 5, fuelAvgOverride: effectiveFuelAvg(2, [4]) });
    expect(out.fuelAvgLap).toBe(4);
    expect(out.fuelDelta).toBeCloseTo(16 - 5 * 4, 6);
  });
});

describe("session state laps", () => {
  it("laps started in parade or after the checkered flag are invalid", () => {
    const t = new FuelTracker();
    const d = new FakeDriver(100, 2);
    const run = (state: number) => {
      for (let i = 0; i < 10; i++) t.update({ ...d.step(), sessionState: state });
    };
    t.update({ ...d.sample(), sessionState: 3 });
    // A lap takes its start state from the sample at the line, so each lap starts in the
    // state of the previous run's last sample.
    run(3);
    run(4);
    run(5);
    run(6);
    expect(t.lapRecords.map((l) => l.reason)).toEqual(["paceLap", "paceLap", null, "cooldown"]);
  });
});
