import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { gapText, headToHead } from "./head-to-head";

function field(opts: { type?: "race" | "practice"; livePos?: boolean } = {}) {
  // Overall order by live class position: car 1 (P1), car 2 (P2), player 3 (P3), car 4, car 5 (other class)
  return fixtureFrame({
    playerCarIdx: 3,
    session: { type: opts.type ?? "race" },
    player: { lap: { currentLapS: 20, lastLapS: 100, bestLapS: 99, delta: null } },
    cars: [
      {
        carIdx: 1,
        classId: "A",
        classColour: "#ff0000",
        carNumber: "1",
        driverName: "Ann Lead",
        lastLapS: 99.5,
      },
      {
        carIdx: 2,
        classId: "A",
        classColour: "#ff0000",
        carNumber: "2",
        driverName: "Bob Ahead",
        lastLapS: 100.4,
      },
      {
        carIdx: 3,
        classId: "A",
        classColour: "#ff0000",
        carNumber: "3",
        driverName: "Me Driver",
        lastLapS: 100,
      },
      {
        carIdx: 4,
        classId: "A",
        classColour: "#ff0000",
        carNumber: "4",
        driverName: "Cy Behind",
        lastLapS: 99.7,
      },
      {
        carIdx: 5,
        classId: "B",
        classColour: "#0000ff",
        carNumber: "5",
        driverName: "Di Other",
        lastLapS: 101,
      },
    ],
    standings: [
      { carIdx: 1, liveClassPosition: 1, classPosition: 1, interval: null },
      { carIdx: 2, liveClassPosition: 2, classPosition: 3, interval: { laps: 0, seconds: 2.5 } },
      { carIdx: 3, liveClassPosition: 3, classPosition: 2, interval: { laps: 0, seconds: 1.24 } },
      { carIdx: 4, liveClassPosition: 4, classPosition: 4, interval: { laps: 0, seconds: 0.86 } },
      { carIdx: 5, liveClassPosition: 1, classPosition: 1, interval: null },
    ],
  });
}

describe("headToHead", () => {
  it("finds the cars one live class place ahead and behind", () => {
    const f = field();
    const h = headToHead(f.state, f.derived.standings, 5, true);
    expect(h?.ahead).toMatchObject({
      classPosition: 2,
      carNumber: "2",
      name: "B. Ahead",
      gapText: "-1.2",
      classColour: "#ff0000",
    });
    expect(h?.behind).toMatchObject({ classPosition: 4, carNumber: "4", gapText: "+0.9" });
    // their last lap minus yours: ahead was slower than you (you were faster), behind was faster
    expect(h?.ahead?.lastLapDiffS).toBeCloseTo(0.4, 6);
    expect(h?.behind?.lastLapDiffS).toBeCloseTo(-0.3, 6);
  });

  it("ignores other classes", () => {
    const f = field();
    // car 5 is class B with live class position 1; the player's class leader is car 1
    const h = headToHead(f.state, f.derived.standings, 5, true);
    expect(h?.ahead?.carNumber).not.toBe("5");
  });

  it("uses the official class positions when live positions are off", () => {
    const f = field();
    const h = headToHead(f.state, f.derived.standings, 5, false);
    // player is official P2: ahead is official P1 (car 1), behind official P3 (car 2)
    expect(h?.ahead?.carNumber).toBe("1");
    expect(h?.behind?.carNumber).toBe("2");
  });

  it("shows whole laps as 1L", () => {
    const f = field();
    const entries = f.derived.standings?.entries ?? [];
    const me = entries.find((e) => e.carIdx === 3);
    const behind = entries.find((e) => e.carIdx === 4);
    if (me) me.interval = { laps: 1, seconds: 3 };
    if (behind) behind.interval = { laps: 2, seconds: null };
    const h = headToHead(f.state, f.derived.standings, 5, true);
    expect(h?.ahead?.gapText).toBe("1L");
    expect(h?.behind?.gapText).toBe("2L");
  });

  it("handles the ends of the field", () => {
    const f = field();
    const entries = f.derived.standings?.entries ?? [];
    // the player becomes the class leader
    for (const e of entries) {
      if (e.carIdx === 3) e.liveClassPosition = 1;
      if (e.carIdx === 1) e.liveClassPosition = 3;
      if (e.carIdx === 2) e.liveClassPosition = 2;
    }
    const h = headToHead(f.state, f.derived.standings, 5, true);
    expect(h?.ahead).toBeNull();
    expect(h?.behind?.carNumber).toBe("2");
  });

  it("is null when there is nobody around", () => {
    const f = fixtureFrame({
      playerCarIdx: 1,
      session: { type: "race" },
      cars: [{ carIdx: 1, classId: "A" }],
      standings: [{ carIdx: 1, liveClassPosition: 1 }],
    });
    expect(headToHead(f.state, f.derived.standings, 5, true)).toBeNull();
  });

  it("is null outside races, on lap 1 and without lap or standings", () => {
    const f = field({ type: "practice" });
    expect(headToHead(f.state, f.derived.standings, 5, true)).toBeNull();
    const r = field();
    expect(headToHead(r.state, r.derived.standings, 1, true)).toBeNull();
    expect(headToHead(r.state, r.derived.standings, null, true)).toBeNull();
    expect(headToHead(r.state, null, 5, true)).toBeNull();
    expect(headToHead(r.state, r.derived.standings, 2, true)).not.toBeNull();
  });

  it("leaves the last lap difference null when a lap is unknown", () => {
    const f = field();
    const car = f.state.cars.find((c) => c.carIdx === 2);
    if (car) car.lastLapS = null;
    const h = headToHead(f.state, f.derived.standings, 5, true);
    expect(h?.ahead?.lastLapDiffS).toBeNull();
  });
});

describe("gapText", () => {
  it("formats seconds, laps and unknowns", () => {
    expect(gapText({ laps: 0, seconds: 1.25 }, "-")).toBe("-1.3");
    expect(gapText({ laps: 0, seconds: 0.94 }, "+")).toBe("+0.9");
    expect(gapText({ laps: 3, seconds: null }, "+")).toBe("3L");
    expect(gapText({ laps: 0, seconds: null }, "+")).toBe("--");
    expect(gapText(null, "-")).toBe("--");
  });
});
