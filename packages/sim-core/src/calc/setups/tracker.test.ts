import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type SimSource, type SimState } from "../../model";
import type { LapHistory, LapRecord } from "../laps/types";
import { SETUP_LAP_SETTLE_S, SetupCompareTracker, setupComboKey } from "./tracker";
import type { SetupCombo, SetupCompare, SetupStatsStore } from "./types";

class MemoryStore implements SetupStatsStore {
  readonly data = new Map<string, SetupCombo>();
  saves = 0;
  load(key: string): SetupCombo | null {
    return this.data.get(key) ?? null;
  }
  save(key: string, combo: SetupCombo): void {
    this.saves++;
    this.data.set(key, combo);
  }
}

const SPA = "iracing|porsche-911-gt3-r|iracing_spa_gp";

/** Drives the tracker as the Deriver does: one state and the lap history per tick. */
class Run {
  t = 100;
  done = 0;
  laps: LapRecord[] = [];
  setup: { name: string; modified: boolean } | null = { name: "spa_race_v1.sto", modified: false };
  speed = 50;
  constructor(
    readonly tracker: SetupCompareTracker,
    readonly source: SimSource = "iracing",
  ) {}

  state(): SimState {
    const s = emptySimState(this.source);
    s.sim = this.source === "mock" ? null : "iracing";
    s.connected = true;
    s.tickTimeS = this.t;
    s.playerCarIdx = 0;
    s.session.trackName = this.source === "mock" ? "Mock Raceway" : "Spa";
    s.session.trackConfig = "GP";
    const car = emptyCar(0);
    car.carName = "Porsche 911 GT3 R";
    car.lapsCompleted = this.done;
    s.cars = [car];
    s.player.speedMps = this.speed;
    s.player.setup = this.setup;
    return s;
  }

  history(): LapHistory {
    return { carIdx: 0, laps: this.laps, bestLapS: null, bestLapNumber: null, optimalLapS: null };
  }

  tick(dtS = 1): SetupCompare | null {
    this.t += dtS;
    return this.tracker.next(this.state(), this.history());
  }

  /**
   * Drives a lap with this top speed, then crosses the line; the lap enters the history at once.
   * `then` is loaded at the line (as after a stop in the garage), so the next lap is all on it.
   */
  lap(
    timeS: number,
    patch: Partial<LapRecord> = {},
    topMps = 60,
    then?: { name: string; modified?: boolean },
  ): SetupCompare | null {
    this.speed = topMps;
    this.tick();
    this.speed = 50;
    this.tick();
    this.done++;
    if (then !== undefined) this.setup = { name: then.name, modified: then.modified ?? false };
    this.laps = [
      {
        lapNumber: this.done,
        lapTimeS: timeS,
        valid: true,
        pit: false,
        trackTempC: 30,
        fuelUsedL: 2.4,
        sectorTimes: [30, 40, timeS - 70],
        ...patch,
      },
      ...this.laps,
    ];
    return this.tick();
  }

  settle(): SetupCompare | null {
    return this.tick(SETUP_LAP_SETTLE_S);
  }
}

describe("setupComboKey", () => {
  it("keys sim, car and track like the fuel history, and the mock by its own name", () => {
    const run = new Run(new SetupCompareTracker());
    const s = run.state();
    expect(setupComboKey(s, s.cars[0]!)).toBe(SPA);
    expect(setupComboKey(s, null)).toBeNull();
    const mock = new Run(new SetupCompareTracker(), "mock").state();
    expect(setupComboKey(mock, mock.cars[0]!)).toBe("mock|Porsche 911 GT3 R|mock_mock-raceway_gp");
  });
});

describe("SetupCompareTracker", () => {
  it("is null without a named setup", () => {
    const run = new Run(new SetupCompareTracker());
    run.setup = null;
    expect(run.tick()).toBeNull();
    run.setup = { name: " ", modified: false };
    expect(run.tick()).toBeNull();
  });

  it("shows the loaded setup on both sides before any lap", () => {
    const out = new Run(new SetupCompareTracker()).tick();
    expect(out?.active).toMatchObject({ name: "spa_race_v1", laps: 0, bestLapS: null });
    expect(out?.baseline.name).toBe("spa_race_v1");
    expect(out?.pinned).toBe(false);
  });

  it("counts a lap once it has settled, with its fuel and late sector", () => {
    const run = new Run(new SetupCompareTracker());
    expect(run.lap(100.5, { fuelUsedL: null, sectorTimes: [30, 40, null] })?.active.laps).toBe(0);
    // The fuel and the last sector arrive a moment later.
    run.laps = [{ ...run.laps[0]!, fuelUsedL: 2.35, sectorTimes: [30, 40, 30.5] }];
    run.tick();
    const out = run.settle();
    expect(out?.active).toMatchObject({
      laps: 1,
      bestLapS: 100.5,
      avgLapS: 100.5,
      sectorsS: [30, 40, 30.5],
      topSpeedMps: 60,
      fuelPerLapL: 2.35,
    });
  });

  it("counts a lap at once when a newer lap follows it", () => {
    const run = new Run(new SetupCompareTracker());
    run.lap(101);
    const out = run.lap(100);
    expect(out?.active.laps).toBe(1);
    expect(run.settle()?.active.laps).toBe(2);
  });

  it("keeps the best lap and sectors, and averages the last five laps", () => {
    const run = new Run(new SetupCompareTracker());
    const times = [99, 101, 102, 103, 104, 105, 106];
    times.forEach((t, i) => run.lap(t, { sectorTimes: [30 - i * 0.1, 40, t - 70] }, 60 + i));
    const out = run.settle();
    expect(out?.active.laps).toBe(7);
    expect(out?.active.bestLapS).toBe(99);
    expect(out?.active.avgLapS).toBeCloseTo((102 + 103 + 104 + 105 + 106) / 5, 9);
    expect(out?.active.sectorsS).toEqual([29.4, 40, 29]);
    expect(out?.active.topSpeedMps).toBeCloseTo((62 + 63 + 64 + 65 + 66) / 5, 9);
    expect(out?.active.fuelPerLapL).toBeCloseTo(2.4, 9);
  });

  it("leaves out invalid laps, pit laps and a lap with a setup change", () => {
    const run = new Run(new SetupCompareTracker());
    run.lap(90, { valid: false });
    run.lap(91, { pit: true });
    run.lap(92, { lapTimeS: null });
    // The setup changes half way through the next lap.
    run.tick();
    run.setup = { name: "spa_lowdf_v2.sto", modified: false };
    run.lap(93);
    const out = run.settle();
    expect(out?.active).toMatchObject({ name: "spa_lowdf_v2", laps: 0 });
    expect(out?.baseline).toMatchObject({ name: "spa_lowdf_v2", laps: 0 });
  });

  it("compares the first setup of the session with the one loaded now", () => {
    const run = new Run(new SetupCompareTracker());
    run.lap(100.2);
    run.lap(100.4, {}, 60, { name: "spa_lowdf_v2.sto" });
    run.lap(99.8);
    const out = run.settle();
    expect(out?.baseline).toMatchObject({ name: "spa_race_v1", laps: 2, bestLapS: 100.2 });
    expect(out?.active).toMatchObject({ name: "spa_lowdf_v2", laps: 1, bestLapS: 99.8 });
    // A third setup keeps the session's first as the baseline.
    run.setup = { name: "spa_v3.sto", modified: false };
    expect(run.tick()?.baseline.name).toBe("spa_race_v1");
  });

  it("keeps a modified setup apart from the saved one", () => {
    const run = new Run(new SetupCompareTracker());
    run.lap(100, {}, 60, { name: "spa_race_v1.sto", modified: true });
    run.lap(99);
    const out = run.settle();
    expect(out?.active).toMatchObject({ name: "spa_race_v1*", laps: 1 });
    expect(out?.baseline).toMatchObject({ name: "spa_race_v1", laps: 1 });
  });

  it("returns the same object while nothing changes", () => {
    const run = new Run(new SetupCompareTracker());
    const a = run.tick();
    expect(run.tick()).toBe(a);
  });

  it("stores laps of a live sim and reads them back in a new session", () => {
    const store = new MemoryStore();
    const run = new Run(new SetupCompareTracker({ store }));
    run.lap(100);
    run.settle();
    expect(store.data.get(SPA)?.setups["spa_race_v1"]?.laps).toBe(1);
    const next = new Run(new SetupCompareTracker({ store }));
    next.setup = { name: "spa_lowdf_v2.sto", modified: false };
    const out = next.tick();
    expect(out?.active.laps).toBe(0);
    expect(next.lap(99) && next.settle()?.active.laps).toBe(1);
    expect(Object.keys(store.data.get(SPA)?.setups ?? {})).toEqual(["spa_race_v1", "spa_lowdf_v2"]);
  });

  it("never stores the mock's laps", () => {
    const store = new MemoryStore();
    const run = new Run(new SetupCompareTracker({ store }), "mock");
    run.lap(100);
    expect(run.settle()?.active.laps).toBe(1);
    expect(store.saves).toBe(0);
  });

  it("pins the setup loaded when the option is turned on, and keeps it across sessions", () => {
    const store = new MemoryStore();
    const tracker = new SetupCompareTracker({ store });
    tracker.setPinBaseline(false);
    const run = new Run(tracker);
    run.lap(100, {}, 60, { name: "spa_lowdf_v2.sto" });
    run.lap(99.5);
    tracker.setPinBaseline(true);
    let out = run.settle();
    expect(out?.pinned).toBe(true);
    expect(out?.baseline.name).toBe("spa_lowdf_v2");
    expect(store.data.get(SPA)?.baseline).toBe("spa_lowdf_v2");
    // A new run that starts with the option on uses the pin and does not pin again.
    const later = new SetupCompareTracker({ store });
    later.setPinBaseline(true);
    const run2 = new Run(later);
    run2.setup = { name: "spa_v3.sto", modified: false };
    out = run2.tick();
    expect(out?.baseline).toMatchObject({ name: "spa_lowdf_v2", laps: 1 });
    expect(out?.active.name).toBe("spa_v3");
    expect(store.data.get(SPA)?.baseline).toBe("spa_lowdf_v2");
    // Off again: the session's first setup.
    later.setPinBaseline(false);
    expect(run2.tick()?.baseline.name).toBe("spa_v3");
    expect(run2.tick()?.pinned).toBe(false);
  });

  it("pins the first setup with a valid lap where none is pinned yet", () => {
    const store = new MemoryStore();
    const tracker = new SetupCompareTracker({ store });
    tracker.setPinBaseline(true);
    const run = new Run(tracker);
    expect(run.tick()?.pinned).toBe(false);
    run.lap(100);
    const out = run.settle();
    expect(out?.pinned).toBe(true);
    expect(store.data.get(SPA)?.baseline).toBe("spa_race_v1");
  });

  it("forgets the session's first setup on reset but keeps the stored laps", () => {
    const store = new MemoryStore();
    const tracker = new SetupCompareTracker({ store });
    const run = new Run(tracker);
    run.lap(100);
    run.settle();
    tracker.reset();
    run.setup = { name: "spa_lowdf_v2.sto", modified: false };
    const out = run.tick();
    expect(out?.baseline.name).toBe("spa_lowdf_v2");
    run.setup = { name: "spa_race_v1.sto", modified: false };
    expect(run.tick()?.active.laps).toBe(1);
  });
});
