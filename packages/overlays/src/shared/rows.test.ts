import { describe, expect, it } from "vitest";
import { fixtureFrame } from "./fixtures";
import type { Car, Flags } from "@overlay/sim-core/types";
import { driverRows, flagBadgeKind, reuseRows, type DriverRowOptions } from "./rows";

function noFlags(): Flags {
  return {
    green: false,
    yellow: false,
    fullCourseYellow: false,
    red: false,
    blue: false,
    white: false,
    checkered: false,
    black: false,
    disqualified: false,
    repair: false,
    furled: false,
  };
}

const OPTS: DriverRowOptions = { livePositions: true, gapDecimals: 1, lapDecimals: 3 };

function frame() {
  return fixtureFrame({
    playerCarIdx: 2,
    cars: [
      {
        carIdx: 0,
        driverName: "Max Example",
        position: 1,
        classPosition: 1,
        lastLapS: 90.1236,
        bestLapS: 89.5,
      },
      { carIdx: 1, isPaceCar: true },
      {
        carIdx: 2,
        driverName: "Ada Testova",
        position: 2,
        classPosition: 2,
        lastLapS: 91.0,
        bestLapS: 90.0,
        classId: "gt3",
      },
      {
        carIdx: 3,
        driverName: "Ben Sample",
        position: 3,
        classPosition: 3,
        lastLapS: null,
        fuelFraction: 0.5,
      },
    ],
    standings: [
      {
        carIdx: 3,
        position: 3,
        classPosition: 3,
        livePosition: 2,
        liveClassPosition: 2,
        startPosition: 5,
      },
      {
        carIdx: 0,
        position: 1,
        classPosition: 1,
        livePosition: 1,
        liveClassPosition: 1,
        sessionBest: true,
      },
      { carIdx: 2, position: 2, classPosition: 2, livePosition: 3, liveClassPosition: 3 },
    ],
    gaps: [
      { carIdx: 0, gapS: -0.04, tier: "position" },
      { carIdx: 3, gapS: 1.26, tier: "position" },
    ],
  });
}

describe("driverRows", () => {
  it("joins by carIdx, skips pace cars, keeps state.cars order", () => {
    const rows = driverRows(frame(), OPTS);
    expect(rows.map((r) => r.carIdx)).toEqual([0, 2, 3]);
    expect(rows[0]?.fastest).toBe(true);
    expect(rows[2]?.positionsGained).toBe(3);
    expect(rows[1]?.classKey).toBe("gt3");
    expect(rows[0]?.classKey).toBe("");
  });

  it("uses live or official positions and falls back", () => {
    const live = driverRows(frame(), OPTS);
    expect(live.map((r) => r.position)).toEqual([1, 3, 2]);
    const official = driverRows(frame(), { ...OPTS, livePositions: false });
    expect(official.map((r) => r.position)).toEqual([1, 2, 3]);
    const noLive = fixtureFrame({
      cars: [{ carIdx: 0 }],
      standings: [{ carIdx: 0, position: null, livePosition: 7 }],
    });
    expect(driverRows(noLive, { ...OPTS, livePositions: false })[0]?.overallPosition).toBe(7);
    expect(driverRows(noLive, OPTS)[0]?.overallPosition).toBe(7);
  });

  it("rounds gaps without -0 and gives the focus car 0", () => {
    const rows = driverRows(frame(), OPTS);
    expect(Object.is(rows[0]?.relativeGapS, 0)).toBe(true);
    expect(rows[1]?.relativeGapS).toBe(0);
    expect(rows[1]?.isFocus).toBe(true);
    expect(rows[2]?.relativeGapS).toBe(1.3);
    expect(rows[0]?.lastLapS).toBe(90.124);
  });

  it("compares lap times with the focus car", () => {
    const rows = driverRows(frame(), OPTS);
    expect(rows[0]?.lastLapDeltaS).toBe(-0.9);
    expect(rows[0]?.bestLapDeltaS).toBe(-0.5);
    expect(rows[2]?.lastLapDeltaS).toBeNull();
    expect(rows[2]?.energyFraction).toBe(0.5);
  });

  it("has no positionsGained without a start position", () => {
    expect(driverRows(frame(), OPTS)[0]?.positionsGained).toBeNull();
  });

  it("still gives rows without standings", () => {
    const f = fixtureFrame({ cars: [{ carIdx: 0, position: 1, classPosition: 1 }] });
    const row = driverRows(f, OPTS)[0];
    expect(row?.position).toBe(1);
    expect(row?.gapToClassLeader).toBeNull();
  });

  it("returns [] unless live", () => {
    expect(driverRows(null, OPTS)).toEqual([]);
    const f = frame();
    f.status = "waiting";
    expect(driverRows(f, OPTS)).toEqual([]);
  });
});

describe("reuseRows", () => {
  it("keeps identity for unchanged rows and replaces changed ones", () => {
    const a = driverRows(frame(), OPTS);
    const f2 = frame();
    f2.derived.gaps = [
      { carIdx: 0, gapS: -0.04, tier: "position" },
      { carIdx: 3, gapS: 2.5, tier: "position" },
    ];
    const b = reuseRows(a, driverRows(f2, OPTS));
    expect(b[0]).toBe(a[0]);
    expect(b[1]).toBe(a[1]);
    expect(b[2]).not.toBe(a[2]);
    expect(b[2]?.relativeGapS).toBe(2.5);
  });

  it("treats equal gap objects as unchanged", () => {
    const withGap = (seconds: number) =>
      driverRows(
        fixtureFrame({
          cars: [{ carIdx: 0 }],
          standings: [{ carIdx: 0, interval: { laps: 0, seconds } }],
        }),
        OPTS,
      );
    const a = withGap(1.5);
    expect(reuseRows(a, withGap(1.5))[0]).toBe(a[0]);
    expect(reuseRows(a, withGap(1.6))[0]).not.toBe(a[0]);
  });

  it("reuses every row when two frames differ only below the displayed precision", () => {
    const build = (lap: number, noise: number) =>
      driverRows(
        fixtureFrame({
          cars: [0, 1, 2].map((i) => ({
            carIdx: i,
            position: i + 1,
            classPosition: i + 1,
            lapsCompleted: 3,
            lapDistPct: lap,
          })),
          standings: [0, 1, 2].map((i) => ({
            carIdx: i,
            progressLaps: 3 + lap,
            gapToClassLeader: { laps: 0, seconds: i * 1.3 + noise },
            gapToLeader: { laps: 0, seconds: i * 1.3 + noise },
            interval: { laps: 0, seconds: 1.3 + noise },
          })),
          gaps: [0, 1, 2].map((i) => ({ carIdx: i, gapS: i + noise, tier: "position" as const })),
        }),
        OPTS,
      );
    const a = build(0.5, 0);
    const b = reuseRows(a, build(0.5005, 0.0004));
    expect(b.every((row, i) => row === a[i])).toBe(true);
  });
});

describe("yellow rows and flag badges", () => {
  it("is yellow off track or under a yellow flag, but not on pit road", () => {
    const rows = driverRows(
      fixtureFrame({
        cars: [
          { carIdx: 0 },
          { carIdx: 1, trackSurface: "offTrack" },
          { carIdx: 2, flags: { ...noFlags(), yellow: true } },
          { carIdx: 3, flags: { ...noFlags(), yellow: true }, onPitRoad: true },
          { carIdx: 4, trackSurface: "onTrack" },
        ],
      }),
      OPTS,
    );
    expect(rows.map((r) => r.yellow)).toEqual([false, true, true, false, false]);
  });

  it("carries the projected iRating change", () => {
    const rows = driverRows(
      fixtureFrame({
        cars: [{ carIdx: 0 }, { carIdx: 1 }],
        standings: [{ carIdx: 0, iRatingChange: 14 }, { carIdx: 1 }],
      }),
      OPTS,
    );
    expect(rows.map((r) => r.iRatingChange)).toEqual([14, null]);
  });

  it("picks the flag badge by priority DSQ > BLK > DMG > YEL", () => {
    const car = (flags: Partial<Flags> | null, surface: Car["trackSurface"] = null): Car => ({
      ...fixtureFrame({ cars: [{ carIdx: 0 }] }).state.cars[0]!,
      flags: flags === null ? null : { ...noFlags(), ...flags },
      trackSurface: surface,
    });
    expect(flagBadgeKind(car(null))).toBeNull();
    expect(flagBadgeKind(car({}))).toBeNull();
    expect(flagBadgeKind(car({ yellow: true }))).toBe("yel");
    expect(flagBadgeKind(car({ yellow: true, repair: true }))).toBe("dmg");
    expect(flagBadgeKind(car({ yellow: true, repair: true, black: true }))).toBe("blk");
    expect(flagBadgeKind(car({ furled: true }))).toBe("blk");
    expect(flagBadgeKind(car({ black: true, disqualified: true }))).toBe("dsq");
    expect(flagBadgeKind(car(null, "offTrack"))).toBe("yel");
  });
});
