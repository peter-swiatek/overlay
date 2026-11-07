import { describe, expect, it } from "vitest";
import { StandingsTracker, strengthOfField } from "./index";
import { newPitHistory, stepPit } from "./pit";
import { linearReference, mkInputs, mkState, type CarSpec } from "./testHelpers";

function run(cars: CarSpec[], session = {}, inputs = mkInputs()) {
  const t = new StandingsTracker();
  const s = t.next(mkState(cars, session), inputs);
  if (!s) throw new Error("no standings");
  return s;
}

function by(s: ReturnType<typeof run>, idx: number) {
  const e = s.entries.find((x) => x.carIdx === idx);
  if (!e) throw new Error("missing");
  return e;
}

describe("null cases", () => {
  it("is null when disconnected or without cars", () => {
    const t = new StandingsTracker();
    const s = mkState([{ carIdx: 0 }]);
    s.connected = false;
    expect(t.next(s, mkInputs())).toBeNull();
    expect(t.next(mkState([]), mkInputs())).toBeNull();
  });

  it("excludes the pace car and keeps state.cars order", () => {
    const s = run([
      { carIdx: 5, lapDistPct: 0.1 },
      { carIdx: 0, isPaceCar: true, lapDistPct: 0.9 },
      { carIdx: 2, lapDistPct: 0.3 },
    ]);
    expect(s.entries.map((e) => e.carIdx)).toEqual([5, 2]);
    expect(by(s, 2).livePosition).toBe(1);
  });
});

describe("race order and gaps", () => {
  it("orders by distance, not by the official position, across the S/F line", () => {
    const s = run([
      { carIdx: 1, position: 2, lapsCompleted: 3, lapDistPct: 0.01 },
      { carIdx: 2, position: 1, lapsCompleted: 2, lapDistPct: 0.99 },
    ]);
    expect(by(s, 1).livePosition).toBe(1);
    expect(by(s, 2).livePosition).toBe(2);
    expect(by(s, 2).gapToLeader?.laps).toBe(0);
  });

  it("gives laps down and a fraction in [0,1) using the position fallback", () => {
    const s = run([
      { carIdx: 0, lapsCompleted: 5, lapDistPct: 0.5 },
      { carIdx: 1, lapsCompleted: 4, lapDistPct: 0.25 },
      { carIdx: 2, lapsCompleted: 3, lapDistPct: 0.5 },
    ]);
    expect(by(s, 0).gapToLeader).toEqual({ laps: 0, seconds: 0 });
    expect(by(s, 1).gapToLeader?.laps).toBe(1);
    expect(by(s, 1).gapToLeader?.seconds).toBeCloseTo(0.25 * 90, 6);
    expect(by(s, 2).gapToLeader?.laps).toBe(2);
    expect(by(s, 2).gapToLeader?.seconds).toBeCloseTo(0, 6);
    expect(by(s, 2).interval?.laps).toBe(0);
    expect(by(s, 2).interval?.seconds).toBeCloseTo(0.75 * 90, 6);
  });

  it("walks the lap-time chain: average, car best, class best, session best, 90 s", () => {
    const lead: CarSpec = { carIdx: 0, classId: "a", lapsCompleted: 2, lapDistPct: 0.5 };
    const chaser: CarSpec = { carIdx: 1, classId: "a", lapsCompleted: 2, lapDistPct: 0 };
    const secs = (cars: CarSpec[], inputs = mkInputs()) =>
      by(run(cars, {}, inputs), 1).gapToLeader?.seconds;
    expect(secs([lead, chaser])).toBeCloseTo(45);
    expect(secs([lead, chaser], mkInputs({ sessionBestLapS: () => 70 }))).toBeCloseTo(35);
    // Class best from the tracker (here no car has a sim best lap).
    expect(
      secs([lead, chaser], mkInputs({ classBestLapS: () => 60, sessionBestLapS: () => 70 })),
    ).toBeCloseTo(30);
    expect(secs([lead, { ...chaser, bestLapS: 80 }])).toBeCloseTo(40);
    expect(
      secs(
        [lead, { ...chaser, bestLapS: 80 }],
        mkInputs({ averageLapS: (i) => (i === 1 ? 100 : undefined) }),
      ),
    ).toBeCloseTo(50);
  });

  it("uses the car's reference lap before the class reference", () => {
    const cars: CarSpec[] = [
      { carIdx: 0, lapsCompleted: 2, lapDistPct: 0.5 },
      { carIdx: 1, lapsCompleted: 2, lapDistPct: 0 },
    ];
    const own = run(
      cars,
      {},
      mkInputs({
        carReference: () => linearReference(100),
        trackReference: () => linearReference(60),
      }),
    );
    expect(by(own, 1).gapToLeader?.seconds).toBeCloseTo(50);
    const track = run(cars, {}, mkInputs({ trackReference: () => linearReference(60) }));
    expect(by(track, 1).gapToLeader?.seconds).toBeCloseTo(30);
  });

  it("adds the lap time when the reference difference is negative", () => {
    const s = run(
      [
        { carIdx: 0, lapsCompleted: 3, lapDistPct: 0.1 },
        { carIdx: 1, lapsCompleted: 2, lapDistPct: 0.9 },
      ],
      {},
      mkInputs({ carReference: () => linearReference(100) }),
    );
    expect(by(s, 1).gapToLeader?.laps).toBe(0);
    expect(by(s, 1).gapToLeader?.seconds).toBeCloseTo(20, 5);
  });

  it("handles classes, class leaders and intervals", () => {
    const s = run([
      { carIdx: 0, classId: "gt", lapsCompleted: 4, lapDistPct: 0.2 },
      { carIdx: 1, classId: "hy", lapsCompleted: 5, lapDistPct: 0.0 },
      { carIdx: 2, classId: "gt", lapsCompleted: 4, lapDistPct: 0.1 },
      { carIdx: 3, classId: "hy", lapsCompleted: 4, lapDistPct: 0.5 },
    ]);
    expect(s.entries.map((e) => e.livePosition)).toEqual([3, 1, 4, 2]);
    expect(s.entries.map((e) => e.liveClassPosition)).toEqual([1, 1, 2, 2]);
    expect(by(s, 0).gapToClassLeader).toEqual({ laps: 0, seconds: 0 });
    expect(by(s, 0).interval).toBeNull();
    expect(by(s, 0).gapToLeader?.laps).toBe(0);
    expect(by(s, 2).interval?.seconds).toBeCloseTo(0.1 * 90);
    expect(by(s, 2).gapToClassLeader?.seconds).toBeCloseTo(0.1 * 90);
    expect(by(s, 3).interval?.laps).toBe(0);
    expect(by(s, 3).interval?.seconds).toBeCloseTo(0.5 * 90);
  });

  it("leaves a car with unknown progress out of the live order", () => {
    const s = run([
      { carIdx: 0, position: 2, lapsCompleted: 1, lapDistPct: 0.5 },
      { carIdx: 1, position: 1, lapsCompleted: null, lapDistPct: null },
      { carIdx: 2, position: 3, lapsCompleted: 1, lapDistPct: 0.2 },
    ]);
    expect(by(s, 1).livePosition).toBeNull();
    expect(by(s, 1).gapToLeader).toBeNull();
    expect(by(s, 1).progressLaps).toBeNull();
    expect(by(s, 0).livePosition).toBe(1);
    expect(by(s, 2).livePosition).toBe(2);
  });

  it("breaks progress ties by official position", () => {
    const s = run([
      { carIdx: 0, position: 2, lapsCompleted: 1, lapDistPct: 0.5 },
      { carIdx: 1, position: 1, lapsCompleted: 1, lapDistPct: 0.5 },
    ]);
    expect(by(s, 1).livePosition).toBe(1);
    expect(by(s, 0).gapToLeader).toEqual({ laps: 0, seconds: 0 });
  });

  it("freezes the order of cars that took the flag", () => {
    const t = new StandingsTracker();
    const at = (a: number, b: number, phase: "racing" | "checkered", pa = 0.99, pb = 0.99) =>
      mkState(
        [
          { carIdx: 0, position: 1, lapsCompleted: a, lapDistPct: pa },
          { carIdx: 1, position: 2, lapsCompleted: b, lapDistPct: pb },
        ],
        { phase },
      );
    t.next(at(9, 9, "racing"), mkInputs());
    t.next(at(10, 9, "checkered", 0.01), mkInputs());
    t.next(at(10, 10, "checkered", 0.05, 0.01), mkInputs());
    // Car 1 is further round the lap now, but car 0 finished first.
    const s = t.next(at(10, 10, "checkered", 0.1, 0.5), mkInputs());
    expect(s?.entries.map((e) => e.livePosition)).toEqual([1, 2]);
  });
});

describe("other sessions", () => {
  it("orders by official position with best-lap gaps", () => {
    const s = run(
      [
        { carIdx: 0, position: 2, bestLapS: 91.5 },
        { carIdx: 1, position: 1, bestLapS: 90 },
        { carIdx: 2, position: 3, bestLapS: null },
      ],
      { type: "practice" },
    );
    expect(by(s, 1).livePosition).toBe(1);
    expect(by(s, 0).gapToLeader).toEqual({ laps: 0, seconds: 1.5 });
    expect(by(s, 2).gapToLeader).toEqual({ laps: 0, seconds: null });
    expect(by(s, 0).interval?.seconds).toBeCloseTo(1.5);
    expect(by(s, 2).livePosition).toBe(3);
  });

  it("falls back to best lap when positions are null", () => {
    const s = run([{ carIdx: 0, bestLapS: 92 }, { carIdx: 1, bestLapS: 90 }, { carIdx: 2 }], {
      type: "qualifying",
    });
    expect(s.entries.map((e) => e.livePosition)).toEqual([2, 1, null]);
    expect(s.entries.map((e) => e.startPosition)).toEqual([null, null, null]);
  });
});

describe("bests", () => {
  it("flags session and class best holders, ties included", () => {
    const s = run(
      [
        { carIdx: 0, classId: "a", bestLapS: 90 },
        { carIdx: 1, classId: "a", bestLapS: 91 },
        { carIdx: 2, classId: "b", bestLapS: 95 },
        { carIdx: 3, classId: "b", bestLapS: 95 },
        { carIdx: 4, classId: null },
      ],
      { type: "practice" },
    );
    expect(s.sessionBestLapS).toBe(90);
    expect(s.classBestLapS).toEqual({ a: 90, b: 95 });
    expect(s.entries.map((e) => e.sessionBest)).toEqual([true, false, false, false, false]);
    expect(s.entries.map((e) => e.classBest)).toEqual([true, false, true, true, false]);
  });

  it("falls back to the tracker's laps and exposes the average", () => {
    const s = run(
      [{ carIdx: 0, classId: "a" }],
      {},
      mkInputs({
        sessionBestLapS: () => 88,
        classBestLapS: (k) => (k === "a" ? 89 : undefined),
        averageLapS: () => 90.25,
      }),
    );
    expect(s.sessionBestLapS).toBe(88);
    expect(s.classBestLapS).toEqual({ a: 89 });
    expect(by(s, 0).avgLapS).toBe(90.25);
  });
});

describe("strength of field", () => {
  it("matches the hand-computed example", () => {
    // 1600 * log2(3 / (2^-0.9375 + 2^-1.25 + 2^-1.875)) = 2086
    const sum = 2 ** -0.9375 + 2 ** -1.25 + 2 ** -1.875;
    expect(Math.round(1600 * Math.log2(3 / sum))).toBe(2086);
    expect(strengthOfField([1500, 2000, 3000])).toBe(2086);
    expect(strengthOfField([2000])).toBe(2000);
    expect(strengthOfField([0, null])).toBeNull();
  });

  it("is computed overall and per class, ignoring unrated cars", () => {
    const s = run([
      { carIdx: 0, classId: "a", iRating: 1500 },
      { carIdx: 1, classId: "a", iRating: 3000 },
      { carIdx: 2, classId: "b", iRating: 2000 },
      { carIdx: 3, classId: "b", iRating: null },
      { carIdx: 4, isPaceCar: true, iRating: 1 },
    ]);
    expect(s.sof).toBe(strengthOfField([1500, 3000, 2000]));
    expect(s.classSof).toEqual({ a: strengthOfField([1500, 3000]), b: 2000 });
    expect(run([{ carIdx: 0 }]).sof).toBeNull();
  });
});

describe("pit tracking", () => {
  it("does not count a garage exit by cars that start outside the world", () => {
    const t = new StandingsTracker();
    const at = (connected: boolean, onPitRoad: boolean) =>
      t.next(
        mkState([{ carIdx: 0, connected, onPitRoad, lapsCompleted: null, lapDistPct: 0.5 }], {
          phase: "gridding",
        }),
        mkInputs(),
      );
    // Garage: not in the world, pit-road flag off then on; then onto pit road; then out.
    at(false, false);
    at(false, true);
    at(true, true);
    const out = at(true, false);
    expect(out?.entries[0]?.pitStops).toBe(0);
    // A later real visit still counts (no stall information, so entry and exit decide).
    at(true, true);
    expect(at(true, false)?.entries[0]?.pitStops).toBe(1);
  });

  it("does not let an earlier spell on track make the garage exit a stop", () => {
    const h = newPitHistory();
    stepPit(h, false, 0);
    stepPit(h, true, 0, false);
    stepPit(h, true, 0, true, true);
    stepPit(h, false, 0);
    expect(h.pitStops).toBe(0);
  });

  it("does not count a drive-through when the stall is known, and counts a stop", () => {
    const h = newPitHistory();
    stepPit(h, false, 3);
    stepPit(h, true, 3, true, false);
    stepPit(h, true, 3, true, false);
    stepPit(h, false, 3, true, false);
    expect(h).toMatchObject({ pitStops: 0, stintStartLap: 3 });
    stepPit(h, true, 4, true, false);
    stepPit(h, true, 4, true, true);
    stepPit(h, true, 4, true, false);
    stepPit(h, false, 4, true, false);
    expect(h).toMatchObject({ pitStops: 1, lastPitLap: 4, stintStartLap: 4 });
  });

  it("does not count the initial garage exit", () => {
    const h = newPitHistory();
    stepPit(h, true, 0);
    stepPit(h, true, 0);
    stepPit(h, false, 0);
    expect(h.pitStops).toBe(0);
    expect(h.lastPitLap).toBeNull();
  });

  it("counts two stops with stint bookkeeping", () => {
    const h = newPitHistory();
    stepPit(h, true, 0);
    stepPit(h, false, 0);
    stepPit(h, true, 10);
    stepPit(h, false, 10);
    expect(h).toMatchObject({ pitStops: 1, lastPitLap: 10, prevStintLaps: 10, stintStartLap: 10 });
    stepPit(h, true, 25);
    stepPit(h, false, 26);
    expect(h).toMatchObject({ pitStops: 2, lastPitLap: 26, prevStintLaps: 16, stintStartLap: 26 });
  });

  it("counts a drive-through as a stop and ignores unknown flags", () => {
    const h = newPitHistory();
    stepPit(h, false, 2);
    stepPit(h, null, 2);
    stepPit(h, true, 3);
    stepPit(h, false, 3);
    expect(h.pitStops).toBe(1);
  });

  it("starts the stint at the first known lap for cars seen mid-session", () => {
    const t = new StandingsTracker();
    const at = (laps: number, pit: boolean) =>
      t.next(
        mkState([{ carIdx: 0, lapsCompleted: laps, onPitRoad: pit, lapDistPct: 0.5 }]),
        mkInputs(),
      );
    expect(at(7, false)?.entries[0]?.stintLaps).toBe(0);
    expect(at(9, false)?.entries[0]?.stintLaps).toBe(2);
    at(9, true);
    expect(at(9, false)?.entries[0]).toMatchObject({
      pitStops: 1,
      lastPitLap: 9,
      prevStintLaps: 2,
      stintLaps: 0,
    });
  });

  it("counts a 12-lap race from a grid start as 12 stint laps", () => {
    const t = new StandingsTracker();
    let stint: number | null = null;
    for (let lap = -1; lap <= 12; lap++) {
      const s = t.next(
        mkState([{ carIdx: 0, lapsCompleted: lap < 0 ? null : lap, lapDistPct: 0.5 }], {
          phase: "racing",
        }),
        mkInputs(),
      );
      stint = s?.entries[0]?.stintLaps ?? null;
    }
    expect(stint).toBe(12);
  });

  it("has no stint length while lapsCompleted is unknown", () => {
    expect(by(run([{ carIdx: 0, lapsCompleted: null }]), 0).stintLaps).toBeNull();
  });
});

describe("start positions and reset", () => {
  const grid = (phase: "gridding" | "racing", leadFirst: boolean) =>
    mkState(
      [
        { carIdx: 0, position: 1, lapsCompleted: 0, lapDistPct: leadFirst ? 0.02 : 0.01 },
        { carIdx: 1, position: 2, lapsCompleted: 0, lapDistPct: leadFirst ? 0.01 : 0.02 },
      ],
      { phase },
    );

  it("records the live order once when the race goes green", () => {
    const t = new StandingsTracker();
    expect(t.next(grid("gridding", true), mkInputs())?.entries[0]?.startPosition).toBeNull();
    const green = t.next(grid("racing", true), mkInputs());
    expect(green?.entries.map((e) => e.startPosition)).toEqual([1, 2]);
    const later = t.next(grid("racing", false), mkInputs());
    expect(later?.entries.map((e) => e.livePosition)).toEqual([2, 1]);
    expect(later?.entries.map((e) => e.startPosition)).toEqual([1, 2]);
  });

  it("reset clears history", () => {
    const t = new StandingsTracker();
    t.next(grid("gridding", true), mkInputs());
    t.next(grid("racing", true), mkInputs());
    t.reset();
    // Joining a race already a lap in has no start grid.
    const midRace = mkState(
      [
        { carIdx: 0, position: 1, lapsCompleted: 3, lapDistPct: 0.2 },
        { carIdx: 1, position: 2, lapsCompleted: 3, lapDistPct: 0.1 },
      ],
      { phase: "racing" },
    );
    expect(t.next(midRace, mkInputs())?.entries.map((e) => e.startPosition)).toEqual([null, null]);
  });

  it("records the grid when the previous phase is unknown (LMU maps most phases to null)", () => {
    const t = new StandingsTracker();
    const green = t.next(grid("racing", true), mkInputs());
    expect(green?.entries.map((e) => e.startPosition)).toEqual([1, 2]);
  });

  it("treats a missing lap count with a known lap fraction as a lap behind on the iRacing grid", () => {
    const t = new StandingsTracker();
    // Before the first crossing iRacing reports -1 completed laps (null here); the car nearest
    // the line is at pct 0.98, the front row.
    const green = mkState(
      [
        { carIdx: 0, position: 2, lapsCompleted: null, lapDistPct: 0.97 },
        { carIdx: 1, position: 1, lapsCompleted: null, lapDistPct: 0.98 },
      ],
      { phase: "racing" },
    );
    const s = t.next(green, mkInputs());
    expect(s?.entries.map((e) => e.startPosition)).toEqual([2, 1]);
    expect(s?.entries[1]?.progressLaps).toBeCloseTo(-0.02);
  });
});

describe("timed race finish", () => {
  const car = (idx: number, position: number, laps: number | null, pct: number, over = {}) => ({
    carIdx: idx,
    position,
    lapsCompleted: laps,
    lapDistPct: pct,
    ...over,
  });
  const frame = (phase: "racing" | "checkered" | "cooldown", cars: CarSpec[]) =>
    mkState(cars, { phase });
  const order = (s: ReturnType<StandingsTracker["next"]>) =>
    [...(s?.entries ?? [])]
      .sort((a, b) => (a.livePosition ?? 99) - (b.livePosition ?? 99))
      .map((e) => e.carIdx);

  it("does not let a lapped car that crosses before the leader take P1", () => {
    const t = new StandingsTracker();
    t.next(
      frame("racing", [car(0, 1, 11, 0.9), car(1, 2, 11, 0.5), car(2, 3, 7, 0.99)]),
      mkInputs(),
    );
    // Time is up; the lapped car crosses first.
    let s = t.next(
      frame("checkered", [car(0, 1, 11, 0.95), car(1, 2, 11, 0.55), car(2, 3, 8, 0.0)]),
      mkInputs(),
    );
    expect(order(s)).toEqual([0, 1, 2]);
    // The leader takes the flag, then the lapped car (a lap down) crosses again later.
    s = t.next(
      frame("checkered", [car(0, 1, 12, 0.0), car(1, 2, 11, 0.7), car(2, 3, 8, 0.4)]),
      mkInputs(),
    );
    expect(order(s)).toEqual([0, 1, 2]);
    expect(s?.entries[0]?.progressLaps).toBe(12);
    s = t.next(
      frame("checkered", [car(0, 1, null, 0.0), car(1, 2, 12, 0.0), car(2, 3, 8, 0.6)]),
      mkInputs(),
    );
    expect(order(s)).toEqual([0, 1, 2]);
    // Cars that leave the world after the flag keep their place.
    s = t.next(
      frame("checkered", [
        car(0, 1, null, 0, { connected: false }),
        car(1, 2, null, 0, { connected: false }),
        car(2, 3, 8, 0.9),
      ]),
      mkInputs(),
    );
    expect(order(s)).toEqual([0, 1, 2]);
    expect(s?.entries[1]?.livePosition).toBe(2);
  });

  it("ranks a car that left the world before finishing and follows official positions in cooldown", () => {
    const t = new StandingsTracker();
    t.next(frame("racing", [car(0, 1, 5, 0.5), car(1, 2, 5, 0.4), car(2, 3, 4, 0.9)]), mkInputs());
    t.next(
      frame("checkered", [car(0, 1, 5, 0.6), car(1, 2, 5, 0.5), car(2, 3, 4, 0.95)]),
      mkInputs(),
    );
    let s = t.next(
      frame("checkered", [
        car(0, 1, 5, 0.7),
        car(1, 2, 5, 0.6),
        car(2, 3, null, 0, { connected: false }),
      ]),
      mkInputs(),
    );
    expect(order(s)).toEqual([0, 1, 2]);
    // The sim's own results win in cooldown, even where the live order disagrees.
    s = t.next(
      frame("cooldown", [
        car(0, 2, null, 0, { connected: false }),
        car(1, 1, null, 0, { connected: false }),
        car(2, 3, null, 0, { connected: false }),
      ]),
      mkInputs(),
    );
    expect(order(s)).toEqual([1, 0, 2]);
  });
});

describe("projected iRating change", () => {
  const cars: CarSpec[] = [
    { carIdx: 1, iRating: 2000, lapDistPct: 0.9 },
    { carIdx: 2, iRating: 2000, lapDistPct: 0.5 },
    { carIdx: 3, iRating: 2000, lapDistPct: 0.1 },
    { carIdx: 4, iRating: null, lapDistPct: 0.05 },
  ];

  it("fills the change in a race from the live order", () => {
    const s = run(cars);
    expect(by(s, 1).iRatingChange as number).toBeGreaterThan(0);
    expect(by(s, 3).iRatingChange as number).toBeLessThan(0);
    expect(by(s, 4).iRatingChange).toBeNull();
  });

  it("is null outside races", () => {
    const s = run(cars, { type: "practice" });
    expect(s.entries.every((e) => e.iRatingChange === null)).toBe(true);
  });

  it("is null for a class with fewer than two rated cars", () => {
    const s = run([
      { carIdx: 1, iRating: 2000, classId: "a", lapDistPct: 0.9 },
      { carIdx: 2, iRating: 2000, classId: "b", lapDistPct: 0.5 },
    ]);
    expect(s.entries.every((e) => e.iRatingChange === null)).toBe(true);
  });
});
