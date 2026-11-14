import { describe, expect, it } from "vitest";
import type { SimState } from "../../model";
import { scriptStates, type ScriptLap, type ScriptOptions } from "./script";
import { CLOSING_PCT, DeltaTracker, deltaInput } from "./tracker";
import type { BestLapRecord, BestLapStore, DeltaOutputs, LapCompletion } from "./types";

class FakeStore implements BestLapStore {
  loads: string[] = [];
  records: { key: string; lap: BestLapRecord }[] = [];
  constructor(private readonly stored: BestLapRecord | null = null) {}
  load(key: string): BestLapRecord | null {
    this.loads.push(key);
    return this.stored;
  }
  record(key: string, lap: BestLapRecord): void {
    this.records.push({ key, lap });
  }
}

const LMU: ScriptOptions = { sim: "lmu", sessionType: "practice" };
const IR: ScriptOptions = { sim: "iracing", sessionType: "practice" };

function feed(tracker: DeltaTracker, states: readonly SimState[]): DeltaOutputs[] {
  return states.map((s) => tracker.next(deltaInput(s, s.cars[0] ?? null))!);
}

function replay(laps: ScriptLap[], options: ScriptOptions, tracker = new DeltaTracker()) {
  const states = scriptStates(laps, options);
  return { states, outs: feed(tracker, states), tracker };
}

/** The output at script time `t` seconds (ticks are 0.1 s). */
function at(outs: readonly DeltaOutputs[], t: number): DeltaOutputs {
  return outs[Math.round(t * 10)]!;
}

function completions(outs: readonly DeltaOutputs[]): LapCompletion[] {
  const seen: LapCompletion[] = [];
  for (const o of outs) {
    if (o.lastCompletion !== null && seen[seen.length - 1] !== o.lastCompletion) {
      seen.push(o.lastCompletion);
    }
  }
  return seen;
}

describe("deltaInput", () => {
  it("is null without a player car or lap data", () => {
    const s = scriptStates([{ lapTimeS: 10 }], LMU)[3]!;
    expect(deltaInput(s, null)).toBeNull();
    s.player.lap = null;
    expect(deltaInput(s, s.cars[0]!)).toBeNull();
  });

  it("reads the lap, the key and whether the source is live", () => {
    const live = scriptStates([{ lapTimeS: 10 }], IR)[5]!;
    const input = deltaInput(live, live.cars[0]!)!;
    expect(input.bestLapKey).toMatch(/^iracing\|test-car\|/);
    expect(input.record).toBe(true);
    expect(input.lapInProgress).toBe(1);
    const replayed = scriptStates([{ lapTimeS: 10 }], { ...IR, source: "replay" })[5]!;
    expect(deltaInput(replayed, replayed.cars[0]!)!.record).toBe(false);
    const mock = scriptStates([{ lapTimeS: 10 }], { ...IR, source: "mock" })[5]!;
    expect(deltaInput(mock, mock.cars[0]!)!.record).toBe(false);
  });
});

describe("computed delta (LMU)", () => {
  const { outs } = replay(
    [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }, { lapTimeS: 100 }],
    LMU,
  );

  it("has no reference trace on the first laps", () => {
    const o = at(outs, 150);
    expect(o.references.lastLap).toMatchObject({ lapTimeS: 100, hasTrace: false });
    expect(o.live.lastLap?.deltaS).toBeNull();
    expect(o.live.lastLap?.source).toBeNull();
  });

  it("measures lap 3 against the best lap 2: +0.5 at half distance, +1.0 at the end", () => {
    // Lap 3 runs from 199 s to 299 s.
    const mid = at(outs, 249).live.sessionBestClean!;
    expect(mid.deltaS!).toBeCloseTo(0.5, 2);
    expect(mid.source).toBe("computed");
    const end = at(outs, 298.9).live.sessionBestClean!;
    expect(end.deltaS!).toBeCloseTo(1.0, 1);
  });

  it("gives a negative delta speed and a rising delta when slower than the reference", () => {
    const live = at(outs, 260).live.sessionBestClean!;
    expect(live.speedDeltaMps!).toBeLessThan(0);
    expect(live.speedDeltaMps!).toBeCloseTo(4000 / 100 - 4000 / 99, 1);
    expect(live.rate!).toBeGreaterThan(0.005);
    expect(live.rate!).toBeLessThan(0.02);
  });

  it("publishes the lap number and the time into the lap", () => {
    const o = at(outs, 250);
    expect(o.lapNumber).toBe(3);
    expect(o.currentLapS!).toBeCloseTo(51, 1);
    expect(o.outLap).toBe(false);
  });
});

describe("clean laps", () => {
  const laps: ScriptLap[] = [
    { lapTimeS: 100 },
    { lapTimeS: 100, incidentAtPct: 0.5 },
    { lapTimeS: 100, offTrack: [0.3, 0.35] },
    { lapTimeS: 100, pitRoad: [0.4, 0.5] },
    { lapTimeS: 100, invalid: true },
    { lapTimeS: 100 },
    { lapTimeS: 100 },
  ];

  it("classifies incident, off-track, pit and invalid laps as unclean (iRacing)", () => {
    const { outs } = replay(laps, IR);
    const c = completions(outs);
    expect(c.map((x) => x.lapNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c.map((x) => x.clean)).toEqual([true, false, false, false, false, true]);
    expect(c[4]!.lapTimeS).toBeNull();
    expect(c[0]!.lapTimeS).toBe(100);
  });

  it("flags the current lap while it is dirty", () => {
    const { outs } = replay(laps, IR);
    expect(at(outs, 120).currentLapClean).toBe(true);
    expect(at(outs, 160).currentLapClean).toBe(false); // lap 2, after its incident
    expect(at(outs, 220).currentLapClean).toBe(true); // lap 3, before the off-track part
    expect(at(outs, 250).currentLapClean).toBe(false);
    expect(at(outs, 310).currentLapClean).toBe(true); // lap 4, before the pit road part
    expect(at(outs, 360).currentLapClean).toBe(false);
  });

  it("counts every LMU lap away from pit road as clean", () => {
    const { outs } = replay(laps, LMU);
    expect(completions(outs).map((x) => x.clean)).toEqual([true, true, true, false, false, true]);
  });

  it("marks the lap after an in lap as an out lap", () => {
    const { outs } = replay(
      [
        { lapTimeS: 100 },
        { lapTimeS: 100, pitRoad: [0.9, 1] },
        { lapTimeS: 100, pitRoad: [0, 0.1] },
        { lapTimeS: 100 },
        { lapTimeS: 100 },
      ],
      IR,
    );
    expect(at(outs, 150).outLap).toBe(false);
    expect(at(outs, 250).outLap).toBe(true);
    expect(at(outs, 350).outLap).toBe(false);
    const c = completions(outs);
    expect(c.map((x) => x.clean)).toEqual([true, false, false, true]);
  });

  it("treats a session that starts on pit road as an out lap", () => {
    const { outs } = replay([{ lapTimeS: 100 }, { lapTimeS: 100 }], {
      ...IR,
      startOnPitRoad: true,
    });
    expect(at(outs, 1).outLap).toBe(true);
    expect(at(outs, 150).outLap).toBe(false);
  });
});

describe("session best clean against session best", () => {
  const laps: ScriptLap[] = [
    { lapTimeS: 100 },
    { lapTimeS: 98, offTrack: [0.4, 0.45] },
    { lapTimeS: 99 },
    { lapTimeS: 100 },
    { lapTimeS: 100 },
  ];

  it("keeps the dirty fastest lap as session best and the clean one as session best clean", () => {
    const { outs, states } = replay(laps, IR);
    const o = at(outs, 350); // lap 4
    expect(o.references.sessionBest?.lapTimeS).toBe(98);
    expect(o.references.sessionBestClean?.lapTimeS).toBe(99);
    expect(o.sessionBest.lapTimeS).toBe(99); // clean first
    // The sim channel serves the session best; the clean lap is computed from our trace.
    const sessionBest = o.live.sessionBest!;
    expect(sessionBest.source).toBe("sim");
    expect(sessionBest.deltaS).toBe(states[3500]!.player.lap!.delta!.sessionBest!.s);
    const clean = o.live.sessionBestClean!;
    expect(clean.source).toBe("computed");
    expect(clean.deltaS).not.toBeNull();
    expect(clean.deltaS).not.toBeCloseTo(sessionBest.deltaS!, 1);
  });

  it("uses the channel for the clean lap when it is also the fastest", () => {
    const { outs } = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 98 }, { lapTimeS: 99 }, { lapTimeS: 99 }],
      IR,
    );
    const o = at(outs, 330);
    expect(o.references.sessionBestClean?.lapTimeS).toBe(98);
    expect(o.live.sessionBestClean?.source).toBe("sim");
  });

  it("gives null with the channel's ok flag false, rate included", () => {
    const { outs } = replay(laps, IR);
    const o = at(outs, 297.5); // under 2 s into lap 4: the channel is not ok
    expect(o.live.sessionBest).toMatchObject({ deltaS: null, rate: null, source: null });
  });

  it("passes the sim's rate on, clamped", () => {
    const { outs } = replay(laps, IR);
    const live = at(outs, 350).live.lastLap!;
    expect(live.source).toBe("sim");
    expect(Math.abs(live.rate!)).toBeLessThanOrEqual(1);
  });
});

describe("closing lap, lap time arrival and best-time deltas", () => {
  // iRacing: the lap time arrives 1 s after the line. Lap 3 runs 199 s to 297 s.
  const { outs } = replay(
    [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 98 }, { lapTimeS: 100 }, { lapTimeS: 100 }],
    IR,
  );

  it("closes the lap from 97 % and takes the snapshot of the references then", () => {
    expect(CLOSING_PCT).toBe(0.97);
    expect(at(outs, 289).closingLap).toBe(false);
    expect(at(outs, 294.5).closingLap).toBe(true);
    expect(at(outs, 297.5).closingLap).toBe(true);
    expect(at(outs, 298.1).closingLap).toBe(false);
  });

  it("waits for the lap time after the line", () => {
    expect(at(outs, 297.5).lastCompletion?.lapNumber).toBe(2);
    const c = at(outs, 298.1).lastCompletion!;
    expect(c.lapNumber).toBe(3);
    expect(c.lapTimeS).toBe(98);
    expect(c.completedAtS!).toBeCloseTo(298, 1);
  });

  it("hides the best-time deltas until the lap time is in, then shows them against the bests before the lap", () => {
    expect(at(outs, 295).allTimeBest.lastLapDeltaS).toBeNull();
    expect(at(outs, 297.5).sessionBest.lastLapDeltaS).toBeNull();
    const o = at(outs, 298.1);
    expect(o.allTimeBest.lastLapDeltaS!).toBeCloseTo(-1, 6);
    expect(o.sessionBest.lastLapDeltaS!).toBeCloseTo(-1, 6);
    expect(o.allTimeBest.setByLastLap).toBe(true);
    expect(o.sessionBest.setByLastLap).toBe(true);
    expect(o.allTimeBest.lapTimeS).toBe(98);
    expect(o.lastCompletion?.references).toMatchObject({
      allTimeBest: 99,
      sessionBestClean: 99,
      sessionBest: 99,
      lastLap: 99,
    });
  });

  it("shows a slower lap against the best as it stood and clears the flags", () => {
    const o = at(outs, 398.1);
    expect(o.lastCompletion?.lapNumber).toBe(4);
    expect(o.allTimeBest.lastLapDeltaS!).toBeCloseTo(2, 6);
    expect(o.allTimeBest.setByLastLap).toBe(false);
    expect(o.sessionBest.setByLastLap).toBe(false);
    expect(o.allTimeBest.lapTimeS).toBe(98);
  });

  it("takes the snapshot at the line when the lap never reached 97 %", () => {
    const states = scriptStates([{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 98 }], LMU);
    // Cut lap 2 off at 90 % with a jump forward of the lap count only.
    const trimmed = states.filter((s) => !(s.tickTimeS! > 190 && s.tickTimeS! < 199));
    const o = feed(new DeltaTracker(), trimmed);
    const lap2 = completions(o)[1]!;
    expect(lap2.lapNumber).toBe(2);
    expect(lap2.references.lastLap).toBe(100);
  });

  it("takes an identical lap time after the 3 s wait", () => {
    const r = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 100 }, { lapTimeS: 100 }, { lapTimeS: 100 }],
      IR,
    );
    expect(at(r.outs, 202.5).lastCompletion?.lapNumber).toBe(1);
    expect(at(r.outs, 203.2).lastCompletion?.lapNumber).toBe(2);
    expect(at(r.outs, 203.2).lastCompletion?.completedAtS ?? 0).toBeGreaterThan(202.9);
    expect(at(r.outs, 203.2).lastCompletion?.completedAtS ?? 0).toBeLessThan(203.2);
    expect(at(r.outs, 203.2).lastCompletion?.lapTimeS).toBe(100);
  });

  it("does not wait when the time arrives with the line (LMU)", () => {
    const r = replay([{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }], LMU);
    expect(at(r.outs, 199).lastCompletion?.lapNumber).toBe(2);
    expect(at(r.outs, 198.9).lastCompletion?.lapNumber).toBe(1);
  });

  it("treats a missing lap time as an invalid lap", () => {
    const r = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 100, invalid: true }, { lapTimeS: 100 }, { lapTimeS: 100 }],
      IR,
    );
    const c = at(r.outs, 202).lastCompletion!;
    expect(c.lapNumber).toBe(2);
    expect(c.lapTimeS).toBeNull();
    expect(c.clean).toBe(false);
  });
});

describe("auto reference", () => {
  it("uses the last lap on race laps 1 and 2, then the session best clean lap", () => {
    const { outs } = replay(
      [
        { lapTimeS: 100 },
        { lapTimeS: 99 },
        { lapTimeS: 100 },
        { lapTimeS: 100 },
        { lapTimeS: 100 },
      ],
      { ...IR, sessionType: "race" },
    );
    expect(at(outs, 50).autoKind).toBeNull(); // nothing to compare with yet
    expect(at(outs, 150).autoKind).toBe("lastLap");
    expect(at(outs, 250).autoKind).toBe("sessionBestClean");
  });

  it("uses the all-time best from the store in qualifying", () => {
    const store = new FakeStore({ lapTimeS: 97, trace: null });
    const { outs } = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }],
      {
        ...IR,
        sessionType: "qualifying",
      },
      new DeltaTracker({ store }),
    );
    expect(at(outs, 1).autoKind).toBe("allTimeBest");
    expect(at(outs, 250).autoKind).toBe("allTimeBest");
    expect(at(outs, 250).references.allTimeBest?.lapTimeS).toBe(97);
  });

  it("uses the last lap in Offline Testing", () => {
    const { outs } = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }, { lapTimeS: 100 }],
      {
        ...IR,
        sessionTypeName: "Offline Testing",
      },
    );
    expect(at(outs, 250).autoKind).toBe("lastLap");
    expect(at(outs, 250).references.sessionBestClean).toBeDefined();
  });

  it("keeps the kind the snapshot saw in the completion", () => {
    const { outs } = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }, { lapTimeS: 100 }],
      { ...IR, sessionType: "race" },
    );
    const c = completions(outs);
    expect(c[1]!.autoKind).toBe("lastLap"); // lap 2
    expect(c[2]!.autoKind).toBe("sessionBestClean"); // lap 3
  });
});

describe("lap complete strip", () => {
  it("shows from the time arriving until 10 s into the new lap", () => {
    const { outs } = replay([{ lapTimeS: 100 }, { lapTimeS: 100 }, { lapTimeS: 100 }], IR);
    expect(at(outs, 100.5).lapCompleteVisible).toBe(false); // time not in yet
    expect(at(outs, 101).lapCompleteVisible).toBe(true);
    expect(at(outs, 109.5).lapCompleteVisible).toBe(true);
    expect(at(outs, 110.5).lapCompleteVisible).toBe(false);
    expect(at(outs, 50).lapCompleteVisible).toBe(false);
  });

  it("is not shown on race laps 1 and 2, but on lap 3", () => {
    const { outs } = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 98 }, { lapTimeS: 97 }],
      {
        ...IR,
        sessionType: "race",
      },
    );
    expect(at(outs, 102).lapCompleteVisible).toBe(false); // lap 2
    expect(at(outs, 202).lapCompleteVisible).toBe(true); // lap 3
  });

  it("is not shown for a lap without a time", () => {
    const { outs } = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 100, invalid: true }, { lapTimeS: 100 }, { lapTimeS: 100 }],
      IR,
    );
    expect(at(outs, 203).lapCompleteVisible).toBe(false);
  });

  it("goes with BEST when the lap beat both bests", () => {
    const { outs } = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }, { lapTimeS: 100 }],
      LMU,
    );
    const best = at(outs, 200);
    expect(best.lapCompleteVisible).toBe(true);
    expect(best.allTimeBest.setByLastLap).toBe(true);
    const slower = at(outs, 300);
    expect(slower.lapCompleteVisible).toBe(true);
    expect(slower.allTimeBest.setByLastLap).toBe(false);
    expect(slower.allTimeBest.lastLapDeltaS!).toBeCloseTo(1, 6);
  });

  it("hides best-time deltas on an out lap", () => {
    const { outs } = replay(
      [
        { lapTimeS: 100 },
        { lapTimeS: 99, pitRoad: [0.9, 1] },
        { lapTimeS: 100, pitRoad: [0, 0.1] },
        { lapTimeS: 100 },
      ],
      LMU,
    );
    expect(at(outs, 150).sessionBest.lastLapDeltaS).toBeNull();
    expect(at(outs, 250).outLap).toBe(true);
    expect(at(outs, 250).allTimeBest.lastLapDeltaS).toBeNull();
    expect(at(outs, 350).allTimeBest.lastLapDeltaS).not.toBeNull();
  });
});

describe("best lap store", () => {
  const laps: ScriptLap[] = [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }];

  it("loads once when the key becomes known and uses the stored lap", () => {
    const store = new FakeStore({ lapTimeS: 97, trace: null });
    const { outs } = replay(laps, IR, new DeltaTracker({ store }));
    expect(store.loads).toHaveLength(1);
    expect(store.loads[0]).toMatch(/^iracing\|test-car\|/);
    expect(at(outs, 1).allTimeBest.lapTimeS).toBe(97);
    expect(at(outs, 250).allTimeBest.lapTimeS).toBe(97);
    expect(store.records).toHaveLength(0);
  });

  it("seeds from the sim's best lap, then records the faster clean traced lap", () => {
    const store = new FakeStore();
    replay(laps, IR, new DeltaTracker({ store }));
    expect(store.records.map((r) => r.lap.lapTimeS)).toEqual([100, 99]);
    expect(store.records[0]!.lap.trace).toBeNull();
    expect(store.records[1]!.lap.trace).not.toBeNull();
    expect(store.records[1]!.lap.trace!.timeS).toHaveLength(400);
  });

  it("does not record a dirty lap", () => {
    const store = new FakeStore({ lapTimeS: 100, trace: null });
    replay(
      [
        { lapTimeS: 100 },
        { lapTimeS: 99, offTrack: [0.4, 0.45] },
        { lapTimeS: 100 },
        { lapTimeS: 100 },
      ],
      { ...IR, source: "iracing" },
      new DeltaTracker({ store }),
    );
    // The sim's own best (99) is seeded as time only; the dirty lap brings no trace.
    expect(store.records.every((r) => r.lap.trace === null)).toBe(true);
  });

  it("lets a tie with a trace replace a time-only entry", () => {
    const store = new FakeStore({ lapTimeS: 99, trace: null });
    const { outs } = replay(laps, IR, new DeltaTracker({ store }));
    expect(store.records).toHaveLength(1);
    expect(store.records[0]!.lap.lapTimeS).toBe(99);
    expect(store.records[0]!.lap.trace).not.toBeNull();
    expect(at(outs, 250).references.allTimeBest?.hasTrace).toBe(true);
  });

  it("never writes from a replay or the mock source", () => {
    for (const source of ["replay", "mock"] as const) {
      const store = new FakeStore();
      const { outs } = replay(laps, { ...IR, source }, new DeltaTracker({ store }));
      expect(store.records).toHaveLength(0);
      // The bests still exist in memory.
      expect(at(outs, 250).allTimeBest.lapTimeS).toBe(99);
    }
  });

  it("works without a store", () => {
    const { outs } = replay(laps, LMU);
    expect(at(outs, 250).allTimeBest.lapTimeS).toBe(99);
    expect(at(outs, 250).references.allTimeBest?.hasTrace).toBe(true);
  });

  it("computes the LMU delta against the all-time best from its stored trace", () => {
    const store = new FakeStore();
    const first = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }],
      LMU,
      new DeltaTracker({ store }),
    );
    expect(first.outs.length).toBeGreaterThan(0);
    const saved = store.records[store.records.length - 1]!.lap;
    expect(saved.trace).not.toBeNull();
    const next = new FakeStore(saved);
    const { outs } = replay(
      [{ lapTimeS: 100 }, { lapTimeS: 100 }],
      LMU,
      new DeltaTracker({ store: next }),
    );
    const live = at(outs, 150).live.allTimeBest!;
    expect(live.source).toBe("computed");
    expect(live.deltaS!).toBeCloseTo(0.5, 2);
  });
});

describe("discontinuities", () => {
  it("drops a lap whose distance jumps and keeps its time", () => {
    const states = scriptStates(
      [
        { lapTimeS: 100 },
        { lapTimeS: 99 },
        { lapTimeS: 100 },
        { lapTimeS: 100 },
        { lapTimeS: 100 },
      ],
      LMU,
    );
    for (let i = 2600; i < 2700; i++) {
      const car = states[i]!.cars[0]!;
      car.lapDistPct = Math.min(0.999, (car.lapDistPct ?? 0) + 0.2);
    }
    const outs = feed(new DeltaTracker(), states);
    expect(at(outs, 255).live.sessionBestClean?.deltaS).not.toBeNull();
    expect(at(outs, 265).live.sessionBestClean?.deltaS).toBeNull();
    expect(at(outs, 285).live.sessionBestClean?.deltaS).toBeNull();
    const o = at(outs, 300);
    expect(o.lastCompletion).toMatchObject({ lapNumber: 3, lapTimeS: 100 });
    expect(o.references.lastLap).toMatchObject({ lapTimeS: 100, hasTrace: false });
    expect(o.live.lastLap?.deltaS).toBeNull();
    // The next lap is fine again.
    expect(at(outs, 350).live.sessionBestClean?.deltaS).not.toBeNull();
  });

  it("drops the lap in progress when the lap count jumps", () => {
    const states = scriptStates(
      [
        { lapTimeS: 100 },
        { lapTimeS: 99 },
        { lapTimeS: 100 },
        { lapTimeS: 101 },
        { lapTimeS: 102 },
      ],
      LMU,
    ).filter((s) => !(s.tickTimeS! >= 250 && s.tickTimeS! < 400));
    const outs = feed(new DeltaTracker(), states);
    expect(completions(outs).map((c) => c.lapNumber)).toEqual([1, 2, 5]);
    expect(completions(outs)[2]!.lapTimeS).toBe(102);
    expect(outs[outs.length - 1]!.references.lastLap?.hasTrace).toBe(false);
  });

  it("copes with the lap fraction wrapping before the lap count moves", () => {
    const states = scriptStates(
      [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 98 }, { lapTimeS: 100 }],
      LMU,
    );
    // The lap time is already new while the lap count still lags behind the wrapped fraction.
    for (const i of [1990, 1991]) states[i]!.cars[0]!.lapsCompleted = 1;
    const outs = feed(new DeltaTracker(), states);
    expect(at(outs, 200.5).lastCompletion?.lapNumber).toBe(2);
    expect(at(outs, 200.5).references.lastLap).toMatchObject({ lapTimeS: 99, hasTrace: true });
  });

  it("forgets the session on reset() and restarts mid lap", () => {
    const states = scriptStates(
      [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }, { lapTimeS: 100 }],
      LMU,
    );
    const tracker = new DeltaTracker();
    feed(tracker, states.slice(0, 1500));
    tracker.reset();
    const after = feed(tracker, states.slice(1500));
    // Only the sim's own best lap survives, as a time.
    expect(Object.keys(after[0]!.references).sort()).toEqual(["allTimeBest", "sessionBest"]);
    expect(after[0]!.lastCompletion).toBeNull();
    expect(after[0]!.live.sessionBest?.deltaS).toBeNull();
    // Lap 2 was started mid lap: it has a time but no trace.
    const o = after[2000 - 1500]!;
    expect(o.references.lastLap).toMatchObject({ lapTimeS: 99, hasTrace: false });
    expect(completions(after).map((c) => c.lapNumber)).toEqual([2, 3]);
  });

  it("returns null without input and keeps its state", () => {
    const tracker = new DeltaTracker();
    expect(tracker.next(null)).toBeNull();
    const states = scriptStates([{ lapTimeS: 10 }], LMU);
    expect(tracker.next(deltaInput(states[5]!, states[5]!.cars[0]!))).not.toBeNull();
  });
});

describe("optimal lap", () => {
  const fastFirst = (p: number) => (p < 0.5 ? 2 : 1);
  const fastSecond = (p: number) => (p < 0.5 ? 1 : 2);

  it("sums the best sectors of two complementary clean laps", () => {
    const { outs } = replay(
      [
        { lapTimeS: 100 },
        { lapTimeS: 100, speedAt: fastFirst },
        { lapTimeS: 100, speedAt: fastSecond },
        { lapTimeS: 100 },
      ],
      LMU,
    );
    expect(at(outs, 150).optimalLapS).toBeNull(); // lap 1 has no trace
    expect(at(outs, 250).optimalLapS!).toBeCloseTo(100, 6);
    expect(at(outs, 350).optimalLapS!).toBeCloseTo(200 / 3, 0);
  });

  it("ignores unclean laps", () => {
    const { outs } = replay(
      [
        { lapTimeS: 100 },
        { lapTimeS: 100, speedAt: fastFirst },
        { lapTimeS: 100, speedAt: fastSecond, pitRoad: [0.4, 0.5] },
        { lapTimeS: 100 },
      ],
      LMU,
    );
    expect(at(outs, 350).optimalLapS!).toBeCloseTo(100, 6);
  });
});
