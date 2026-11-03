import { describe, expect, it } from "vitest";
import { scriptStates } from "../calc/delta/script";
import type { BestLapRecord, BestLapStore } from "../calc/delta";
import { Deriver } from "./derive";
import type { Derived } from "./frame";
import { MockSource } from "./mock";

/** Runs the demo race through the real Deriver, keeping the state's lap and the derived delta. */
function runMock(seconds: number): { t: number; lap: number | null; derived: Derived }[] {
  const mock = new MockSource();
  const deriver = new Deriver();
  const out: { t: number; lap: number | null; derived: Derived }[] = [];
  for (let i = 0; i < seconds * 10; i++) {
    const state = mock.step(0.1);
    const derived = deriver.next(state);
    out.push({ t: state.tickTimeS!, lap: state.cars[0]?.lapInProgress ?? null, derived });
  }
  return out;
}

describe("Deriver delta", () => {
  const frames = runMock(520);

  it("publishes delta from the first frame, with the sim's channels for the live values", () => {
    expect(frames[0]!.derived.delta).not.toBeNull();
    // Mid lap 2 (the demo player starts 0.24 laps in; lap 2 runs from 76 s to 176 s).
    const mid = frames.find((f) => f.t >= 120)!;
    const live = mid.derived.delta!.live;
    expect(live.sessionBest?.source).toBe("sim");
    expect(live.lastLap?.source).toBe("sim");
    expect(live.lastLap?.deltaS).not.toBeNull();
    expect(live.lastLap?.rate).not.toBeNull();
  });

  it("separates the session best from the best clean lap after the demo's unclean lap 3", () => {
    const f = frames.find((x) => x.t >= 420)!; // lap 5
    const refs = f.derived.delta!.references;
    expect(f.lap).toBe(5);
    expect(refs.sessionBest?.lapTimeS).toBeCloseTo(99.5, 6); // lap 3, unclean
    expect(refs.sessionBestClean?.lapTimeS).toBeCloseTo(99.6, 6); // lap 4
    expect(f.derived.delta!.sessionBest.lapTimeS).toBeCloseTo(99.6, 6);
    // The channel serves the session best; the clean lap is computed from our trace.
    expect(f.derived.delta!.live.sessionBest?.source).toBe("sim");
    expect(f.derived.delta!.live.sessionBestClean?.source).toBe("computed");
  });

  it("shows the lap complete strip right after a line, and not late in the lap", () => {
    const after = frames.find((f) => f.derived.delta!.lastCompletion?.lapNumber === 4)!;
    expect(after.derived.delta!.lapCompleteVisible).toBe(true);
    const late = frames.find((f) => f.lap === 5 && f.derived.delta!.currentLapS! > 50)!;
    expect(late.derived.delta!.lapCompleteVisible).toBe(false);
  });

  it("does not write to the best lap store for the mock source", () => {
    const records: BestLapRecord[] = [];
    const store: BestLapStore = { load: () => null, record: (_k, lap) => void records.push(lap) };
    const deriver = new Deriver({ bestLaps: store });
    const mock = new MockSource();
    for (let i = 0; i < 4000; i++) deriver.next(mock.step(0.1));
    expect(records).toEqual([]);
  });
});

describe("Deriver delta with scripted laps", () => {
  it("writes clean laps from a live source and forgets the session on reset()", () => {
    const records: BestLapRecord[] = [];
    const store: BestLapStore = { load: () => null, record: (_k, lap) => void records.push(lap) };
    const deriver = new Deriver({ bestLaps: store });
    const states = scriptStates([{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }], {
      sim: "lmu",
      sessionType: "practice",
    });
    let last: Derived | null = null;
    for (const s of states) last = deriver.next(s);
    expect(records.some((r) => r.lapTimeS === 99 && r.trace !== null)).toBe(true);
    expect(last!.delta!.references.allTimeBest?.lapTimeS).toBe(99);
    deriver.reset();
    const first = deriver.next(states[0]!);
    expect(first.delta!.lastCompletion).toBeNull();
    expect(first.delta!.references.lastLap).toBeUndefined();
  });

  it("starts over when the session type changes", () => {
    const deriver = new Deriver();
    const practice = scriptStates([{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }], {
      sim: "lmu",
      sessionType: "practice",
    });
    for (const s of practice) deriver.next(s);
    const race = scriptStates([{ lapTimeS: 100 }, { lapTimeS: 100 }], {
      sim: "lmu",
      sessionType: "race",
    });
    const out = deriver.next(race[0]!);
    expect(out.delta!.lastCompletion).toBeNull();
    expect(out.delta!.references.sessionBestClean).toBeUndefined();
  });

  it("is null for a disconnected state", () => {
    const states = scriptStates([{ lapTimeS: 10 }], { sim: "lmu", sessionType: "practice" });
    states[2]!.connected = false;
    expect(new Deriver().next(states[2]!).delta).toBeNull();
  });
});
