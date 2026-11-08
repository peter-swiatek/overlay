import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState } from "../../model";
import type { FuelLapRecord } from "../fuel/types";
import type { Standings, StandingsEntry } from "../standings/types";
import { LapHistoryTracker, lapHistoryInput, type LapHistoryInput } from "./tracker";
import { LAP_HISTORY_MAX } from "./types";

const DT = 0.1;

/** Drives one car around: `lap(time)` runs a whole lap and crosses the line. */
class Driver {
  readonly tracker = new LapHistoryTracker();
  tickS = 0;
  lapsCompleted = 0;
  lastLapS: number | null = null;
  trackTempC = 30;
  sectors: (number | null)[] | null = [null, null, null];
  fuel: FuelLapRecord[] | null = [];
  carIdx = 0;

  input(patch: Partial<LapHistoryInput> = {}): LapHistoryInput {
    return {
      tickS: this.tickS,
      carIdx: this.carIdx,
      lapsCompleted: this.lapsCompleted,
      lastLapS: this.lastLapS,
      onPitRoad: false,
      inPitStall: false,
      trackSurface: "onTrack",
      incidentCount: 0,
      trackTempC: this.trackTempC,
      sectorTimes: this.sectors,
      fuelLaps: this.fuel,
      ...patch,
    };
  }

  tick(patch: Partial<LapHistoryInput> = {}) {
    this.tickS += DT;
    return this.tracker.next(this.input(patch));
  }

  /**
   * A lap of `time` seconds: a few ticks (with `during` applied to the middle one), sector times
   * a third of the lap each, then the line with the time arriving on the same tick.
   */
  lap(
    time: number,
    opts: {
      during?: Partial<LapHistoryInput>;
      timeLate?: boolean;
      fuelUsed?: number;
      fuelValid?: boolean;
    } = {},
  ) {
    this.tick();
    if (this.sectors !== null)
      this.sectors = [time / 3, this.sectors[1] ?? null, this.sectors[2] ?? null];
    this.tick(opts.during);
    if (this.sectors !== null)
      this.sectors = [this.sectors[0] ?? null, time / 3, this.sectors[2] ?? null];
    this.tick();
    if (this.sectors !== null)
      this.sectors = [this.sectors[0] ?? null, this.sectors[1] ?? null, time / 3];
    this.lapsCompleted++;
    if (!opts.timeLate) this.lastLapS = time;
    if (this.fuel !== null && opts.fuelUsed !== undefined) {
      this.fuel = [
        ...this.fuel,
        {
          lapNumber: this.lapsCompleted,
          startState: 4,
          endState: 4,
          usedL: opts.fuelUsed,
          valid: opts.fuelValid ?? true,
          reason: opts.fuelValid === false ? "refuel" : null,
        },
      ];
    }
    const out = this.tick();
    if (opts.timeLate) {
      this.tick();
      this.lastLapS = time;
      return this.tick();
    }
    return out;
  }
}

describe("LapHistoryTracker", () => {
  it("records each lap newest first with its time, temperature, fuel and sectors", () => {
    const d = new Driver();
    d.tick();
    d.lap(100.3, { fuelUsed: 2.4 });
    d.trackTempC = 31.2;
    const out = d.lap(99.8, { fuelUsed: 2.38 });
    expect(out?.carIdx).toBe(0);
    expect(out?.laps.map((l) => l.lapNumber)).toEqual([2, 1]);
    const [two, one] = out!.laps;
    expect(two).toMatchObject({ lapTimeS: 99.8, valid: true, pit: false, trackTempC: 31.2 });
    expect(two?.fuelUsedL).toBe(2.38);
    expect(one).toMatchObject({ lapTimeS: 100.3, trackTempC: 30, fuelUsedL: 2.4 });
    expect(two?.sectorTimes).toEqual([99.8 / 3, 99.8 / 3, 99.8 / 3]);
    expect(out?.bestLapS).toBe(99.8);
    expect(out?.bestLapNumber).toBe(2);
  });

  it("waits for a lap time that arrives after the line", () => {
    const d = new Driver();
    d.tick();
    d.lap(100);
    for (let i = 0; i < 10; i++) d.tick();
    d.lapsCompleted++;
    expect(d.tick()?.laps).toHaveLength(1); // crossed, time not yet in
    d.lastLapS = 99;
    const out = d.tick();
    expect(out?.laps.map((l) => [l.lapNumber, l.lapTimeS])).toEqual([
      [2, 99],
      [1, 100],
    ]);
  });

  it("gives up after the wait and keeps the lap without a time (not valid)", () => {
    const d = new Driver();
    d.tick();
    d.lap(100);
    for (let i = 0; i < 10; i++) d.tick();
    d.lapsCompleted++;
    d.tick();
    for (let i = 0; i < 40; i++) d.tick();
    const lap = d.tracker.next(d.input())?.laps[0];
    expect(lap).toMatchObject({ lapNumber: 2, lapTimeS: null, valid: false });
  });

  it("marks off-track, incident and pit laps invalid and leaves them out of the best", () => {
    const d = new Driver();
    d.tick();
    d.lap(101);
    d.lap(98, { during: { trackSurface: "offTrack" } });
    d.lap(97, { during: { incidentCount: 2 } });
    const out = d.lap(96, { during: { onPitRoad: true } });
    expect(out?.laps.map((l) => [l.lapNumber, l.valid, l.pit])).toEqual([
      [4, false, true],
      [3, false, false],
      [2, false, false],
      [1, true, false],
    ]);
    expect(out?.bestLapS).toBe(101);
    expect(out?.bestLapNumber).toBe(1);
  });

  it("keeps the first lap to reach the best time as the best lap", () => {
    const d = new Driver();
    d.tick();
    d.lap(99.5);
    d.lap(100);
    const out = d.lap(99.5);
    expect(out?.bestLapNumber).toBe(1);
  });

  it("does not count a lap joined part way through", () => {
    const d = new Driver();
    d.lapsCompleted = 4;
    d.lastLapS = 100;
    d.tick();
    const out = d.lap(99);
    expect(out?.laps[0]).toMatchObject({ lapNumber: 5, lapTimeS: 99, valid: false });
    expect(d.lap(99.4)?.laps[0]?.valid).toBe(true);
  });

  it("sums the best sector of the valid laps into the optimal lap", () => {
    const d = new Driver();
    d.tick();
    d.lap(99); // 33 each
    expect(d.tracker.next(d.input())?.optimalLapS).toBeCloseTo(99, 6);
    // A lap faster in sector 2 only.
    d.tick();
    d.sectors = [34, d.sectors![1] ?? null, d.sectors![2] ?? null];
    d.tick();
    d.sectors = [34, 32, d.sectors![2] ?? null];
    d.tick();
    d.sectors = [34, 32, 34];
    d.lapsCompleted++;
    d.lastLapS = 100;
    const out = d.tick();
    expect(out?.laps[0]?.sectorTimes).toEqual([34, 32, 34]);
    expect(out?.optimalLapS).toBeCloseTo(33 + 32 + 33, 6);
    // An invalid lap with faster sectors does not count.
    const after = d.lap(90, { during: { trackSurface: "offTrack" } });
    expect(after?.optimalLapS).toBeCloseTo(98, 6);
  });

  it("gives the last sector to the lap that ended when it completes just after the line", () => {
    const d = new Driver();
    d.tick();
    d.tick();
    d.sectors = [33, null, null];
    d.tick();
    d.sectors = [33, 32, null];
    d.tick();
    d.lapsCompleted++;
    d.lastLapS = 99;
    d.tick();
    d.sectors = [33, 32, 34];
    const out = d.tick();
    expect(out?.laps[0]?.sectorTimes).toEqual([33, 32, 34]);
    expect(out?.optimalLapS).toBeCloseTo(99, 6);
  });

  it("has no optimal lap without sector data", () => {
    const d = new Driver();
    d.sectors = null;
    d.tick();
    const out = d.lap(99);
    expect(out?.laps[0]?.sectorTimes).toBeNull();
    expect(out?.optimalLapS).toBeNull();
  });

  it("shows no fuel for refuel laps or for another car than the player's", () => {
    const d = new Driver();
    d.tick();
    d.lap(100, { fuelUsed: -20, fuelValid: false });
    expect(d.tick()?.laps[0]?.fuelUsedL).toBeNull();
    d.fuel = null;
    expect(d.lap(100)?.laps[0]?.fuelUsedL).toBeNull();
  });

  it("attaches fuel that is recorded a tick after the lap", () => {
    const d = new Driver();
    d.tick();
    d.lap(100);
    expect(d.tick()?.laps[0]?.fuelUsedL).toBeNull();
    d.fuel = [{ lapNumber: 1, startState: 4, endState: 4, usedL: 2.5, valid: true, reason: null }];
    expect(d.tick()?.laps[0]?.fuelUsedL).toBe(2.5);
  });

  it("starts again for a different focus car", () => {
    const d = new Driver();
    d.tick();
    d.lap(100);
    d.carIdx = 3;
    const out = d.tick();
    expect(out?.carIdx).toBe(3);
    expect(out?.laps).toEqual([]);
    expect(out?.bestLapS).toBeNull();
  });

  it("forgets the laps when the lap count goes back", () => {
    const d = new Driver();
    d.tick();
    d.lap(100);
    d.lap(100.5);
    d.lapsCompleted = 0;
    expect(d.tick()?.laps).toEqual([]);
  });

  it(`keeps at most ${LAP_HISTORY_MAX} laps`, () => {
    const d = new Driver();
    d.tick();
    let out = null;
    for (let i = 0; i < LAP_HISTORY_MAX + 5; i++) out = d.lap(100 + (i % 2) * 0.1);
    expect(out?.laps).toHaveLength(LAP_HISTORY_MAX);
    expect(out?.laps[0]?.lapNumber).toBe(LAP_HISTORY_MAX + 5);
  });

  it("returns the same object while nothing changes", () => {
    const d = new Driver();
    d.tick();
    const a = d.lap(100);
    const b = d.tick();
    expect(b).toBe(a);
  });

  it("forgets everything on reset", () => {
    const d = new Driver();
    d.tick();
    d.lap(100);
    d.tracker.reset();
    expect(d.tracker.next(null)).toBeNull();
  });
});

describe("lapHistoryInput", () => {
  function standings(entry: Partial<StandingsEntry>): Standings {
    return {
      entries: [{ carIdx: 2, sectorTimes: [1, 2], ...entry } as StandingsEntry],
      sessionBestLapS: null,
      classBestLapS: {},
      sof: null,
      classSof: {},
    };
  }

  it("follows the player with the player's own lap time, incidents and fuel", () => {
    const s = emptySimState("iracing");
    s.tickTimeS = 5;
    s.playerCarIdx = 2;
    s.conditions.trackTempC = 28;
    s.player.incidentCount = 4;
    s.player.lap = { currentLapS: 1, lastLapS: 99.123, bestLapS: null, delta: null };
    s.cars = [{ ...emptyCar(2), lapsCompleted: 3, lastLapS: 99.1, onPitRoad: true }];
    const fuel: FuelLapRecord[] = [];
    const input = lapHistoryInput(s, standings({}), fuel);
    expect(input).toMatchObject({
      carIdx: 2,
      lapsCompleted: 3,
      lastLapS: 99.123,
      onPitRoad: true,
      incidentCount: 4,
      trackTempC: 28,
      sectorTimes: [1, 2],
    });
    expect(input?.fuelLaps).toBe(fuel);
  });

  it("follows the camera car without incidents or fuel", () => {
    const s = emptySimState("iracing");
    s.tickTimeS = 5;
    s.focusCarIdx = 2;
    s.player.incidentCount = 4;
    s.cars = [{ ...emptyCar(2), lastLapS: 98, trackSurface: "offTrack" }];
    const input = lapHistoryInput(s, null, []);
    expect(input).toMatchObject({
      carIdx: 2,
      lastLapS: 98,
      trackSurface: "offTrack",
      incidentCount: null,
      fuelLaps: null,
      sectorTimes: null,
    });
  });

  it("is null without a focus car or a clock", () => {
    const s = emptySimState("iracing");
    s.tickTimeS = 5;
    expect(lapHistoryInput(s, null, null)).toBeNull();
    s.playerCarIdx = 0;
    s.cars = [emptyCar(0)];
    s.tickTimeS = null;
    expect(lapHistoryInput(s, null, null)).toBeNull();
  });
});
