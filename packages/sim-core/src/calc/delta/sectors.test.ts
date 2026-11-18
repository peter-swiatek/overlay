import { describe, expect, it } from "vitest";
import { scriptStates, type ScriptLap, type ScriptOptions } from "./script";
import { SectorTimer, sectorIndexAt, validSectorStarts } from "./sectors";
import { DeltaTracker, deltaInput } from "./tracker";
import type { DeltaOutputs, SectorTiming } from "./types";

const QUARTERS = [0, 0.25, 0.5, 0.75];
const LMU: ScriptOptions = { sim: "lmu", sessionType: "practice", sectorStartPcts: QUARTERS };
const IR: ScriptOptions = { sim: "iracing", sessionType: "practice", sectorStartPcts: QUARTERS };

function replay(laps: ScriptLap[], options: ScriptOptions): DeltaOutputs[] {
  const tracker = new DeltaTracker();
  return scriptStates(laps, options).map((s) => tracker.next(deltaInput(s, s.cars[0] ?? null))!);
}

/** The sector timing at script time `t` seconds (ticks are 0.1 s). */
function sectorsAt(outs: readonly DeltaOutputs[], t: number): SectorTiming {
  return outs[Math.round(t * 10)]!.sectors!;
}

describe("validSectorStarts and sectorIndexAt", () => {
  it("accepts sorted starts from 0 below 1 and rejects anything else", () => {
    expect(validSectorStarts([0, 0.3, 0.7])).toEqual([0, 0.3, 0.7]);
    expect(validSectorStarts(null)).toBeNull();
    expect(validSectorStarts([])).toBeNull();
    expect(validSectorStarts([0.1, 0.5])).toBeNull();
    expect(validSectorStarts([0, 0.5, 0.5])).toBeNull();
    expect(validSectorStarts([0, 1])).toBeNull();
  });

  it("finds the sector of a lap fraction", () => {
    expect([0, 0.2, 0.25, 0.6, 0.99].map((p) => sectorIndexAt(QUARTERS, p))).toEqual([
      0, 0, 1, 2, 3,
    ]);
  });
});

describe("sector timing in the delta tracker", () => {
  // Lap 1 is joined at the line before a lap count is seen, so its first sector is not timed.
  const outs = replay(
    [{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }, { lapTimeS: 99.5 }],
    LMU,
  );

  it("is null without sector data", () => {
    const plain = replay([{ lapTimeS: 100 }, { lapTimeS: 99 }], { ...LMU, sectorStartPcts: null });
    expect(plain.every((o) => o.sectors === null)).toBe(true);
  });

  it("publishes the starts, the current sector and the car's position", () => {
    const s = sectorsAt(outs, 160); // lap 2, 60 s in
    expect(s.startPcts).toEqual(QUARTERS);
    expect(s.current).toBe(2);
    expect(s.lapDistPct!).toBeCloseTo(60 / 99, 3);
  });

  it("times each sector as it completes and leaves the rest null", () => {
    const s = sectorsAt(outs, 160);
    expect(s.times[0]!).toBeCloseTo(24.75, 2);
    expect(s.times[1]!).toBeCloseTo(24.75, 2);
    expect(s.times.slice(2)).toEqual([null, null]);
  });

  it("marks session-best sectors on the first timed laps (no reference trace yet)", () => {
    const s = sectorsAt(outs, 160);
    expect(s.byReference.sessionBestClean.states).toEqual(["best", "best", null, null]);
    expect(s.byReference.lastLap.deltas).toEqual([null, null, null, null]);
  });

  it("gives the delta against the reference lap's own sector and a loss when slower", () => {
    // Lap 3 (100 s) against the session best lap 2 (99 s): +0.25 s per quarter.
    const s = sectorsAt(outs, 199 + 60);
    expect(s.byReference.sessionBestClean.deltas[0]!).toBeCloseTo(0.25, 2);
    expect(s.byReference.sessionBestClean.deltas[1]!).toBeCloseTo(0.25, 2);
    expect(s.byReference.sessionBestClean.states).toEqual(["loss", "loss", null, null]);
  });

  it("calls a faster sector that is not the session best a gain", () => {
    // Lap 4 (99.5 s) against the last lap (lap 3, 100 s): -0.125 s per quarter, best stays 24.75.
    const s = sectorsAt(outs, 299 + 60);
    expect(s.byReference.lastLap.deltas[0]!).toBeCloseTo(-0.125, 2);
    expect(s.byReference.lastLap.states.slice(0, 2)).toEqual(["gain", "gain"]);
    expect(s.byReference.sessionBestClean.states.slice(0, 2)).toEqual(["loss", "loss"]);
  });

  it("completes the last sector at the line and shows the finished lap for the lap-complete window", () => {
    const just = sectorsAt(outs, 199 + 2); // 2 s into lap 3
    expect(just.times.map((t) => Number(t!.toFixed(2)))).toEqual([24.75, 24.75, 24.75, 24.75]);
    expect(just.byReference.sessionBestClean.states).toEqual(["best", "best", "best", "best"]);
    expect(just.current).toBe(0);
    const later = sectorsAt(outs, 199 + 11); // window over, first sector of lap 3 not done yet
    expect(later.times).toEqual([null, null, null, null]);
  });

  it("ends the window early once a sector of the new lap is done", () => {
    // Long sectors would never hit this; a short first sector (5 % of the lap) does.
    const short = replay([{ lapTimeS: 100 }, { lapTimeS: 99 }, { lapTimeS: 100 }], {
      ...LMU,
      sectorStartPcts: [0, 0.05, 0.5],
    });
    const s = sectorsAt(short, 199 + 6); // 6 s into lap 3; sector 1 took 5 s
    expect(s.times[0]!).toBeCloseTo(5, 1);
    expect(s.times.slice(1)).toEqual([null, null]);
  });

  it("handles a dozen sectors", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => i / 12);
    const many = replay([{ lapTimeS: 120 }, { lapTimeS: 120 }, { lapTimeS: 108 }], {
      ...LMU,
      sectorStartPcts: twelve,
      tailS: 5,
    });
    const s = sectorsAt(many, 348 + 2); // just after lap 3's line
    expect(s.times).toHaveLength(12);
    for (const t of s.times) expect(t!).toBeCloseTo(9, 1);
    for (const d of s.byReference.lastLap.deltas) expect(d!).toBeCloseTo(-1, 1);
    expect(s.byReference.lastLap.states.every((x) => x === "best")).toBe(true);
  });
});

describe("sector bests and clean laps", () => {
  it("does not let a lap that went off track set or keep a best (iRacing)", () => {
    const laps: ScriptLap[] = [
      { lapTimeS: 100 },
      { lapTimeS: 99 },
      { lapTimeS: 98, offTrack: [0.6, 0.62] },
      { lapTimeS: 98.5 },
    ];
    const outs = replay(laps, IR);
    // Lap 3 runs 199..297: its first sectors are bests while the lap is still clean ...
    const before = sectorsAt(outs, 199 + 55);
    expect(before.byReference.sessionBestClean.states.slice(0, 2)).toEqual(["best", "best"]);
    // ... and fall back to gain once it goes off track.
    const after = sectorsAt(outs, 199 + 70);
    expect(after.byReference.sessionBestClean.states.slice(0, 2)).toEqual(["gain", "gain"]);
    // Lap 4 (24.625 a quarter) is the best because lap 3's 24.5 never counted.
    const lap4 = sectorsAt(outs, 297 + 60);
    expect(lap4.byReference.sessionBestClean.states.slice(0, 2)).toEqual(["best", "best"]);
  });

  it("never calls an out lap's sectors bests", () => {
    const outs = replay([{ lapTimeS: 90, pitRoad: [0, 0.05] }, { lapTimeS: 100 }], LMU);
    const s = sectorsAt(outs, 60);
    expect(s.times[1]!).toBeCloseTo(22.5, 1);
    expect(s.byReference.sessionBestClean.states[1]).toBeNull();
  });
});

describe("SectorTimer", () => {
  it("drops the open sector on a jump (tow, reset) and times again from the next boundary", () => {
    const timer = new SectorTimer();
    timer.setTrack(QUARTERS);
    timer.line(0, 0, [], true);
    let t = 0;
    for (let pct = 0.01; pct < 0.2; pct += 0.01) timer.sample(pct, (t += 1), t, [], true);
    timer.sample(0.6, (t += 1), t, [], true); // jump into sector 3
    for (let pct = 0.61; pct < 0.9; pct += 0.01) timer.sample(pct, (t += 1), t, [], true);
    const out = timer.output(0.9, false, true)!;
    expect(out.times[0]).toBeNull();
    expect(out.times[1]).toBeNull();
    expect(out.times[2]).toBeNull(); // its start was skipped by the jump
    expect(out.current).toBe(3);
  });

  it("forgets laps and bests when the track's sectors change", () => {
    const timer = new SectorTimer();
    timer.setTrack(QUARTERS);
    timer.line(0, 0, [], true);
    for (let k = 1; k <= 30; k++) timer.sample(k / 100, k, k, [], true);
    expect(timer.output(0.3, false, true)!.times[0]!).toBeCloseTo(25, 6);
    timer.setTrack([0, 0.5]);
    expect(timer.output(0.3, false, true)!.times).toEqual([null, null]);
    timer.setTrack(null);
    expect(timer.output(0.3, false, true)).toBeNull();
  });
});
