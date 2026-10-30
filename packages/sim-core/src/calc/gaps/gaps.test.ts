import { describe, expect, it } from "vitest";
import {
  GAP_DEFAULT_LAP_TIME_S,
  MiniSectorRecorder,
  RollingLapTimes,
  elapsedAt,
  relativeGap,
  wrapPctDiff,
  wrapTimeDiff,
  type GapReferenceLap,
} from "./index";
import { SLOW_FAST, driveCar, profileLapTime, timeAt, type Segment } from "./testHelpers/synthetic";

function recordedReference(profile: Segment[] = SLOW_FAST, laps = 3): GapReferenceLap {
  const recorder = new MiniSectorRecorder();
  driveCar(recorder, { carIdx: 0, profile, startTimeS: 10, laps });
  const ref = recorder.carReference(0);
  if (!ref) throw new Error("no reference recorded");
  return ref;
}

describe("MiniSectorRecorder", () => {
  it("records elapsed time at 200 points and a lap time from interpolated crossings", () => {
    const ref = recordedReference();
    expect(ref.times).toHaveLength(201);
    expect(ref.lapTimeS).toBeCloseTo(90, 2);
    expect(ref.times[0]).toBe(0);
    for (const i of [1, 37, 100, 101, 150, 199]) {
      expect(ref.times[i]).toBeCloseTo(timeAt(SLOW_FAST, i / 200), 2);
    }
  });

  it("does not make the first (partial) lap a reference but does the first full lap", () => {
    const recorder = new MiniSectorRecorder();
    const laps = driveCar(recorder, {
      carIdx: 3,
      profile: SLOW_FAST,
      startTimeS: 0,
      startPct: 0.3,
      laps: 2,
    });
    // Starting mid-lap: the first crossing ends a partial lap, which is not reported.
    expect(laps).toHaveLength(1);
    expect(laps[0]?.clean).toBe(true);
    expect(recorder.carReference(3)?.lapTimeS).toBeCloseTo(90, 2);
  });

  it("keeps the first clean lap, replaces it only with a faster clean lap", () => {
    const recorder = new MiniSectorRecorder();
    const slow: Segment[] = [{ endPct: 1, durS: 100 }];
    const fast: Segment[] = [{ endPct: 1, durS: 95 }];
    const slower: Segment[] = [{ endPct: 1, durS: 105 }];
    let t = 0;
    for (const [profile, expected] of [
      [slow, 100],
      [slower, 100],
      [fast, 95],
    ] as const) {
      driveCar(recorder, { carIdx: 1, profile, startTimeS: t, laps: 2, firstLap: 1 });
      // Each drive ends on the line where the next one starts, so the laps chain.
      t += 2 * profileLapTime(profile);
      expect(recorder.carReference(1)?.lapTimeS).toBeCloseTo(expected, 2);
    }
  });

  it("rejects laps with pit road, off-track, NotInWorld or missing mini-sectors", () => {
    const run = (mutate: Parameters<typeof driveCar>[1]["mutate"]) => {
      const recorder = new MiniSectorRecorder();
      const laps = driveCar(recorder, {
        carIdx: 2,
        profile: SLOW_FAST,
        startTimeS: 0,
        laps: 4,
        ...(mutate ? { mutate } : {}),
      });
      return { laps, ref: recorder.carReference(2) };
    };

    // The first crossing only starts lap 2 (the first lap is partial), so reports are laps 2..4.
    // Dirty during lap 2 only (session time between 90 and 180).
    const during = (tick: { sessionTimeS: number }) =>
      tick.sessionTimeS > 100 && tick.sessionTimeS < 110;

    const pit = run((t) => {
      if (during(t)) t.onPitRoad = true;
    });
    expect(pit.laps.map((l) => l.clean)).toEqual([false, true, true]);

    const off = run((t) => {
      if (during(t)) t.offTrack = true;
    });
    expect(off.laps.map((l) => l.clean)).toEqual([false, true, true]);

    const notInWorld = run((t) => {
      if (during(t)) {
        t.lapDistPct = -1;
        t.offTrack = true;
      }
    });
    // The dropout restarts tracking, so the broken lap is never reported (and never a reference).
    expect(notInWorld.laps.map((l) => l.clean)).toEqual([true, true]);

    // A tick with an unusable timestamp counts as not being in the world.
    const gap = run((t) => {
      if (during(t)) t.sessionTimeS = Number.NaN;
    });
    expect(gap.laps.map((l) => l.clean)).toEqual([true, true]);
  });

  it("marks a lap unclean when the points are interpolated across a big telemetry gap", () => {
    // 8 s ticks stay under the step limit, so interpolation fills every point and laps are clean.
    // (A lap with empty points cannot arise otherwise: any step over 10% of the lap dirties it.)
    const coarse = new MiniSectorRecorder();
    const laps = driveCar(coarse, {
      carIdx: 0,
      profile: SLOW_FAST,
      startTimeS: 0,
      laps: 3,
      dtS: 5,
    });
    expect(laps.length).toBeGreaterThan(0);
    expect(laps.every((l) => l.clean)).toBe(true);

    const jumpy = new MiniSectorRecorder();
    const jumpyLaps = driveCar(jumpy, {
      carIdx: 0,
      profile: SLOW_FAST,
      startTimeS: 0,
      laps: 3,
      dtS: 20,
    });
    expect(jumpyLaps.length).toBeGreaterThan(0);
    expect(jumpyLaps.some((l) => l.clean)).toBe(false);
    expect(jumpy.carReference(0)).toBeUndefined();
  });

  it("does not trust a lap whose S/F crossing spans a long telemetry gap", () => {
    const recorder = new MiniSectorRecorder();
    const tick = (sessionTimeS: number, lapDistPct: number, lap: number) =>
      recorder.update({
        sessionTimeS,
        carIdx: 5,
        lap,
        lapDistPct,
        onPitRoad: false,
        offTrack: false,
      });
    // One clean lap first so the car is tracked from the line.
    driveCar(recorder, { carIdx: 5, profile: SLOW_FAST, startTimeS: 0, laps: 2 });
    const ref = recorder.carReference(5)?.lapTimeS;
    // driveCar ended on the line at t = 180; keep driving to 0.55, then lose 64 s of telemetry.
    for (let k = 1; k <= 11; k++) tick(180 + k * 2, k * 0.05, 3);
    const done = tick(266, 0.04, 4);
    expect(done?.clean).toBe(false);
    expect(recorder.carReference(5)?.lapTimeS).toBe(ref);
    expect(recorder.trackReference(0)?.lapTimeS).toBe(ref);
  });

  it("reset clears car state, optionally track references; resetCar clears one car", () => {
    const recorder = new MiniSectorRecorder();
    driveCar(recorder, { carIdx: 1, profile: SLOW_FAST, startTimeS: 0, laps: 3 });
    driveCar(recorder, { carIdx: 2, profile: SLOW_FAST, startTimeS: 0, laps: 3 });
    recorder.resetCar(1);
    expect(recorder.carReference(1)).toBeUndefined();
    expect(recorder.carReference(2)).toBeDefined();
    recorder.reset();
    expect(recorder.carReference(2)).toBeUndefined();
    expect(recorder.trackReference(0)).toBeDefined();
    recorder.reset(true);
    expect(recorder.trackReference(0)).toBeUndefined();
  });

  it("keeps track references per class and round-trips them through JSON", () => {
    const recorder = new MiniSectorRecorder();
    driveCar(recorder, { carIdx: 0, classId: 7, profile: SLOW_FAST, startTimeS: 0, laps: 2 });
    const quick: Segment[] = [{ endPct: 1, durS: 80 }];
    driveCar(recorder, { carIdx: 1, classId: 9, profile: quick, startTimeS: 0, laps: 2 });
    driveCar(recorder, {
      carIdx: 2,
      classId: 7,
      profile: [{ endPct: 1, durS: 88 }],
      startTimeS: 0,
      laps: 2,
    });
    expect(recorder.trackReference(7)?.lapTimeS).toBeCloseTo(88, 2);
    expect(recorder.trackReference(9)?.lapTimeS).toBeCloseTo(80, 2);
    expect(recorder.trackReference(1)).toBeUndefined();

    const restored = MiniSectorRecorder.fromJSON(JSON.parse(JSON.stringify(recorder)));
    expect(restored.trackReference(7)).toEqual(recorder.trackReference(7));
    expect(restored.trackReference(9)).toEqual(recorder.trackReference(9));
    expect(restored.carReference(0)).toBeUndefined();
  });

  it("drops persisted references that are not monotonic, inconsistent or implausible", () => {
    const good = recordedReference();
    const make = (edit: (times: number[], r: { lapTimeS: number }) => void) => {
      const times = [...good.times];
      const r = { lapTimeS: good.lapTimeS };
      edit(times, r);
      const json = { version: 1, trackReferences: { "0": { lapTimeS: r.lapTimeS, times } } };
      return MiniSectorRecorder.fromJSON(json).trackReference(0);
    };
    expect(make(() => {})).toBeDefined();
    expect(make((t) => (t[0] = 0.5))).toBeUndefined();
    expect(make((t) => (t[50] = t[49] ?? 0))).toBeUndefined();
    expect(make((t) => (t[60] = 5))).toBeUndefined();
    expect(make((t) => (t[200] = 80))).toBeUndefined();
    expect(make((_t, r) => (r.lapTimeS = 5000))).toBeUndefined();
    expect(make((t) => (t[10] = Number.NaN))).toBeUndefined();
  });

  it("drops malformed persisted references", () => {
    expect(MiniSectorRecorder.fromJSON(null).trackReference(0)).toBeUndefined();
    const bad = { version: 1, trackReferences: { "0": { lapTimeS: 90, times: [0, 1] } } };
    expect(MiniSectorRecorder.fromJSON(bad).trackReference(0)).toBeUndefined();
  });
});

describe("relativeGap, mini-sector tier", () => {
  const ref = recordedReference();

  it("interpolates elapsed time between mini-sector points", () => {
    expect(elapsedAt(ref, 0.0025)).toBeCloseTo(timeAt(SLOW_FAST, 0.0025), 2);
    expect(elapsedAt(ref, 0.7512)).toBeCloseTo(timeAt(SLOW_FAST, 0.7512), 2);
  });

  it("differs from the position-based gap on a slow section and a fast one", () => {
    // Same 20% of lap apart; target ahead (negative gap). Slow half: 24 s, fast half: 12 s.
    const slow = relativeGap(
      { carIdx: 0, lapDistPct: 0.1 },
      { carIdx: 1, lapDistPct: 0.3 },
      { targetReference: ref },
    );
    const fast = relativeGap(
      { carIdx: 0, lapDistPct: 0.6 },
      { carIdx: 1, lapDistPct: 0.8 },
      { targetReference: ref },
    );
    const position = relativeGap(
      { carIdx: 0, lapDistPct: 0.1 },
      { carIdx: 1, lapDistPct: 0.3 },
      { lapTimes: { targetAverageS: 90 } },
    );
    expect(slow).toMatchObject({ tier: "miniSector", reference: "target" });
    expect(slow.gapS).toBeCloseTo(-24, 2);
    expect(fast.gapS).toBeCloseTo(-12, 2);
    expect(position).toMatchObject({ tier: "position", lapTimeSource: "targetAverage" });
    expect(position.gapS).toBeCloseTo(-18, 9);
  });

  it("is positive when the target is behind", () => {
    const g = relativeGap(
      { carIdx: 0, lapDistPct: 0.3 },
      { carIdx: 1, lapDistPct: 0.1 },
      { targetReference: ref },
    );
    expect(g.gapS).toBeCloseTo(24, 2);
  });

  it("wraps across S/F in both directions", () => {
    const ahead = relativeGap(
      { carIdx: 0, lapDistPct: 0.95 },
      { carIdx: 1, lapDistPct: 0.05 },
      { targetReference: ref },
    );
    const behind = relativeGap(
      { carIdx: 0, lapDistPct: 0.05 },
      { carIdx: 1, lapDistPct: 0.95 },
      { targetReference: ref },
    );
    // 0.95 -> 1.0 is 3 s (fast half), 0.0 -> 0.05 is 6 s (slow half).
    expect(ahead.gapS).toBeCloseTo(-9, 2);
    expect(behind.gapS).toBeCloseTo(9, 2);
  });

  it("stays within (-lap/2, lap/2]", () => {
    for (let a = 0; a < 1; a += 0.037) {
      for (let b = 0; b < 1; b += 0.041) {
        const g = relativeGap(
          { carIdx: 0, lapDistPct: a },
          { carIdx: 1, lapDistPct: b },
          { targetReference: ref },
        ).gapS;
        expect(g).toBeGreaterThan(-45 - 1e-9);
        expect(g).toBeLessThanOrEqual(45 + 1e-9);
      }
    }
  });

  it("prefers the target's own reference, else the track reference", () => {
    const trackRef = recordedReference([{ endPct: 1, durS: 80 }]);
    const own = relativeGap(
      { carIdx: 0, lapDistPct: 0.1 },
      { carIdx: 1, lapDistPct: 0.3 },
      { targetReference: ref, trackReference: trackRef },
    );
    const track = relativeGap(
      { carIdx: 0, lapDistPct: 0.1 },
      { carIdx: 1, lapDistPct: 0.3 },
      { trackReference: trackRef },
    );
    expect(own).toMatchObject({ reference: "target", referenceLapTimeS: ref.lapTimeS });
    expect(track).toMatchObject({ reference: "track", referenceLapTimeS: 80 });
    expect(track.gapS).toBeCloseTo(-16, 2);
  });
});

describe("relativeGap, position tier", () => {
  const at = (p: number) => ({ carIdx: 0, lapDistPct: p });

  it("uses gap = (focus% - target%) x lapTime with the same sign as the mini-sector tier", () => {
    const g = relativeGap(at(0.2), at(0.3), { lapTimes: { targetAverageS: 100 } });
    expect(g.gapS).toBeCloseTo(-10, 9);
    expect(relativeGap(at(0.3), at(0.2), { lapTimes: { targetAverageS: 100 } }).gapS).toBeCloseTo(
      10,
      9,
    );
  });

  it("wraps across S/F in both directions", () => {
    const lapTimes = { targetAverageS: 100 };
    expect(relativeGap(at(0.98), at(0.02), { lapTimes }).gapS).toBeCloseTo(-4, 9);
    expect(relativeGap(at(0.02), at(0.98), { lapTimes }).gapS).toBeCloseTo(4, 9);
  });

  it("walks the lap-time chain: average, best, class best, session best, 90 s", () => {
    const pick = (lapTimes: Parameters<typeof relativeGap>[2]) => {
      const r = relativeGap(at(0), at(0.1), lapTimes);
      if (r.tier !== "position") throw new Error("expected position tier");
      return [r.lapTimeSource, r.lapTimeS];
    };
    expect(
      pick({ lapTimes: { targetAverageS: 1, targetBestS: 2, classBestS: 3, sessionBestS: 4 } }),
    ).toEqual(["targetAverage", 1]);
    expect(pick({ lapTimes: { targetBestS: 2, classBestS: 3, sessionBestS: 4 } })).toEqual([
      "targetBest",
      2,
    ]);
    expect(pick({ lapTimes: { classBestS: 3, sessionBestS: 4 } })).toEqual(["classBest", 3]);
    expect(pick({ lapTimes: { sessionBestS: 4 } })).toEqual(["sessionBest", 4]);
    expect(pick({ lapTimes: { targetAverageS: Number.NaN, targetBestS: 0 } })).toEqual([
      "default",
      GAP_DEFAULT_LAP_TIME_S,
    ]);
    expect(pick({})).toEqual(["default", 90]);
  });

  it("never lets a NaN reference reach gapS", () => {
    const times = [...recordedReference().times];
    times[40] = Number.NaN;
    const r = relativeGap(
      { carIdx: 0, lapDistPct: 0.2 },
      { carIdx: 1, lapDistPct: 0.3 },
      { targetReference: { lapTimeS: 90, times } },
    );
    expect(r.tier).toBe("position");
    expect(Number.isFinite(r.gapS)).toBe(true);
  });

  it("is unavailable when a car is not in the world", () => {
    const refs = { targetReference: recordedReference() };
    for (const [a, b] of [
      [-1, 0.3],
      [0.3, -1],
      [0.3, Number.NaN],
      [1.5, 0.2],
    ] as const) {
      const r = relativeGap({ carIdx: 0, lapDistPct: a }, { carIdx: 1, lapDistPct: b }, refs);
      expect(r.tier).toBe("unavailable");
      expect(r.gapS).toBeUndefined();
    }
  });

  it("is used when the reference is missing or malformed", () => {
    const broken: GapReferenceLap = { lapTimeS: 90, times: [0, 90] };
    const r = relativeGap(at(0.2), at(0.3), { targetReference: broken });
    expect(r.tier).toBe("position");
  });
});

describe("wrap helpers", () => {
  it("maps into (-0.5, 0.5] and (-L/2, L/2]", () => {
    expect(wrapPctDiff(0.5)).toBe(0.5);
    expect(wrapPctDiff(-0.5)).toBe(0.5);
    expect(wrapPctDiff(0.75)).toBeCloseTo(-0.25, 12);
    expect(wrapPctDiff(-0.75)).toBeCloseTo(0.25, 12);
    expect(wrapTimeDiff(45, 90)).toBe(45);
    expect(wrapTimeDiff(-45, 90)).toBe(45);
    expect(wrapTimeDiff(100, 90)).toBeCloseTo(10, 12);
  });
});

describe("RollingLapTimes", () => {
  it("averages the last five valid laps and tracks bests", () => {
    const laps = new RollingLapTimes();
    for (const t of [100, 99, 98, 97, 96, 95]) laps.record(4, t, true, 2);
    laps.record(4, 50, false, 2);
    laps.record(4, Number.NaN, true, 2);
    laps.record(5, 93, true, 3);
    expect(laps.average(4)).toBeCloseTo((99 + 98 + 97 + 96 + 95) / 5, 12);
    expect(laps.best(4)).toBe(95);
    expect(laps.classBest(2)).toBe(95);
    expect(laps.classBest(3)).toBe(93);
    expect(laps.sessionBest()).toBe(93);
    expect(laps.average(9)).toBeUndefined();
  });

  it("reset and resetCar forget laps", () => {
    const laps = new RollingLapTimes();
    laps.record(1, 90, true, 2);
    laps.record(2, 95, true, 2);
    laps.resetCar(1);
    expect(laps.average(1)).toBeUndefined();
    expect(laps.best(1)).toBeUndefined();
    expect(laps.average(2)).toBe(95);
    laps.reset();
    expect(laps.average(2)).toBeUndefined();
    expect(laps.sessionBest()).toBeUndefined();
    expect(laps.classBest(2)).toBeUndefined();
  });

  it("averages fewer than five laps", () => {
    const laps = new RollingLapTimes();
    laps.record(1, 90);
    laps.record(1, 92);
    expect(laps.average(1)).toBe(91);
  });
});
