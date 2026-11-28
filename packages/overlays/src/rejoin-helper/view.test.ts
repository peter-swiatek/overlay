import type { Car, DerivedGap, Player, SessionInfo } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import {
  HIDE_AFTER_S,
  NEXT_CAR_RANGE_S,
  SHOW_AFTER_S,
  newRejoinMemory,
  nextCarBehindS,
  playerSituation,
  rejoinTone,
  rejoinView,
  rejoinViewFor,
  sampleRejoinView,
  stepRejoinVisibility,
  type PlayerSituation,
  type RejoinOptions,
} from "./view";

const OPTIONS: RejoinOptions = { redS: 2, cautionS: 5, alwaysShow: false };

function gap(carIdx: number, gapS: number | null): DerivedGap {
  return { carIdx, gapS, tier: gapS === null ? "unavailable" : "position" };
}

function frame(input: {
  cars?: Array<Partial<Car> & { carIdx: number }>;
  gaps?: DerivedGap[];
  player?: Partial<Player>;
  session?: Partial<SessionInfo>;
}) {
  const others = input.cars ?? [];
  return fixtureFrame({
    cars: [{ carIdx: 0, lapDistPct: 0.5, isOnTrack: true, trackSurface: "onTrack" }, ...others],
    playerCarIdx: 0,
    gaps: input.gaps ?? others.map((c) => gap(c.carIdx, 3)),
    player: { speedMps: 50, trackSurface: "onTrack", isOnTrack: true, ...input.player },
    session: { phase: "racing", ...input.session },
  });
}

describe("nextCarBehindS", () => {
  it("is the smallest positive gap of a racing car within range, any class", () => {
    const f = frame({
      cars: [{ carIdx: 1, classId: "1" }, { carIdx: 2, classId: "2" }, { carIdx: 3 }],
      gaps: [gap(1, 4.2), gap(2, 1.4), gap(3, -0.5)],
    });
    expect(nextCarBehindS(f)).toBe(1.4);
  });

  it("is null with no car behind within range", () => {
    expect(nextCarBehindS(frame({}))).toBeNull();
    const far = frame({ cars: [{ carIdx: 1 }], gaps: [gap(1, NEXT_CAR_RANGE_S + 0.1)] });
    expect(nextCarBehindS(far)).toBeNull();
    const ahead = frame({ cars: [{ carIdx: 1 }], gaps: [gap(1, -2)] });
    expect(nextCarBehindS(ahead)).toBeNull();
    const unknown = frame({ cars: [{ carIdx: 1 }], gaps: [gap(1, null)] });
    expect(nextCarBehindS(unknown)).toBeNull();
  });

  it("skips cars in the pits, off track, out of the world, pace cars and disconnected cars", () => {
    const skipped: Array<Partial<Car>> = [
      { onPitRoad: true },
      { inPitStall: true },
      { isOnTrack: false },
      { trackSurface: "offTrack" },
      { trackSurface: "notInWorld" },
      { trackSurface: "inPitStall" },
      { isPaceCar: true },
      { connected: false },
    ];
    for (const extra of skipped) {
      const f = frame({
        cars: [{ carIdx: 1, ...extra }, { carIdx: 2 }],
        gaps: [gap(1, 1), gap(2, 6)],
      });
      expect(nextCarBehindS(f), JSON.stringify(extra)).toBe(6);
    }
  });
});

describe("playerSituation", () => {
  it("is driving at speed on track", () => {
    expect(playerSituation(frame({}))).toBe("driving");
  });

  it("is off when the sim says the player is off track", () => {
    expect(playerSituation(frame({ player: { trackSurface: "offTrack" } }))).toBe("off");
    expect(playerSituation(frame({ player: { trackSurface: "offTrack", speedMps: 3 } }))).toBe(
      "off",
    );
  });

  it("is slow below the slow-car speed on track, and driving when the speed is unknown", () => {
    expect(playerSituation(frame({ player: { speedMps: 14.9 } }))).toBe("slow");
    expect(playerSituation(frame({ player: { speedMps: 0 } }))).toBe("slow");
    expect(playerSituation(frame({ player: { speedMps: 15 } }))).toBe("driving");
    expect(playerSituation(frame({ player: { speedMps: null } }))).toBe("driving");
  });

  it("is away in the pits, the garage and the phases without racing traffic", () => {
    const away = [
      frame({ player: { speedMps: 0, trackSurface: "inPitStall" } }),
      frame({ player: { speedMps: 10, trackSurface: "approachingPits" } }),
      frame({ player: { speedMps: 0, trackSurface: "notInWorld" } }),
      frame({ player: { speedMps: 0, isOnTrack: false } }),
      ...(["garage", "gridding", "formation", "cooldown"] as const).map((phase) =>
        frame({ player: { speedMps: 0 }, session: { phase } }),
      ),
    ];
    for (const f of away) expect(playerSituation(f)).toBe("away");
    const pitRoad = frame({ player: { speedMps: 10 } });
    pitRoad.state.cars[0]!.onPitRoad = true;
    expect(playerSituation(pitRoad)).toBe("away");
  });

  it("uses the player's car surface when the player surface is unknown (LMU gives no off track)", () => {
    const f = frame({ player: { trackSurface: null } });
    f.state.cars[0]!.trackSurface = "offTrack";
    expect(playerSituation(f)).toBe("off");
    const lmu = frame({ player: { trackSurface: null, speedMps: 5 } });
    lmu.state.cars[0]!.trackSurface = null;
    expect(playerSituation(lmu)).toBe("slow");
  });
});

describe("stepRejoinVisibility", () => {
  const run = (steps: Array<[PlayerSituation, number]>) => {
    const m = newRejoinMemory();
    return steps.map(([s, t]) => stepRejoinVisibility(m, s, t));
  };

  it("shows after the debounce when slow having been fast, and hides after back up to speed", () => {
    expect(
      run([
        ["driving", 0],
        ["slow", 1],
        ["slow", 1 + SHOW_AFTER_S - 0.1],
        ["slow", 1 + SHOW_AFTER_S],
        ["driving", 5],
        ["driving", 5 + HIDE_AFTER_S - 0.1],
        ["driving", 5 + HIDE_AFTER_S],
      ]),
    ).toEqual([false, false, false, true, true, true, false]);
  });

  it("shows off track at any speed, without having been fast", () => {
    expect(
      run([
        ["off", 0],
        ["off", SHOW_AFTER_S],
      ]),
    ).toEqual([false, true]);
  });

  it("ignores a short dip and stays up through a brief burst of speed", () => {
    expect(
      run([
        ["driving", 0],
        ["slow", 1],
        ["driving", 1.2],
        ["slow", 1.4],
      ]),
    ).toEqual([false, false, false, false]);
    expect(
      run([
        ["off", 0],
        ["off", 1],
        ["driving", 2],
        ["slow", 3],
        ["driving", 4],
      ]),
    ).toEqual([false, true, true, true, true]);
  });

  it("stays hidden slow on a standing start or out of the pits until the player has been fast", () => {
    expect(
      run([
        ["away", 0],
        ["slow", 1],
        ["slow", 5],
        ["driving", 6],
        ["slow", 7],
        ["slow", 8],
      ]),
    ).toEqual([false, false, false, false, false, true]);
  });

  it("hides at once when the player goes away, and starts over when the clock goes back", () => {
    expect(
      run([
        ["off", 0],
        ["off", 1],
        ["away", 1.1],
        ["slow", 2],
        ["slow", 3],
      ]),
    ).toEqual([false, true, false, false, false]);
    expect(
      run([
        ["off", 10],
        ["off", 11],
        ["off", 5],
      ]),
    ).toEqual([false, true, false]);
  });
});

describe("rejoinTone and rejoinViewFor", () => {
  it("is red below the red threshold, yellow below caution, else clear", () => {
    expect(rejoinTone(0, OPTIONS)).toBe("red");
    expect(rejoinTone(1.99, OPTIONS)).toBe("red");
    expect(rejoinTone(2, OPTIONS)).toBe("yellow");
    expect(rejoinTone(4.99, OPTIONS)).toBe("yellow");
    expect(rejoinTone(5, OPTIONS)).toBe("clear");
    expect(rejoinTone(null, OPTIONS)).toBe("clear");
    expect(rejoinTone(3, { redS: 4, cautionS: 6 })).toBe("red");
  });

  it("gives the gap with one decimal and the condition", () => {
    expect(rejoinViewFor(1.44, OPTIONS)).toEqual({
      tone: "red",
      gap: "1.4",
      condition: "DO NOT REJOIN",
    });
    expect(rejoinViewFor(4.2, OPTIONS)).toEqual({
      tone: "yellow",
      gap: "4.2",
      condition: "CAUTION",
    });
    expect(rejoinViewFor(8, OPTIONS)).toEqual({
      tone: "clear",
      gap: "8.0",
      condition: "CLEAR TO REJOIN",
    });
    expect(rejoinViewFor(null, OPTIONS)).toEqual({
      tone: "clear",
      gap: "--",
      condition: "CLEAR TO REJOIN",
    });
  });
});

describe("rejoinView", () => {
  it("is null without a live frame", () => {
    expect(rejoinView(null, newRejoinMemory(), 0, { ...OPTIONS, alwaysShow: true })).toBeNull();
    const waiting = frame({});
    waiting.status = "waiting";
    expect(rejoinView(waiting, newRejoinMemory(), 0, { ...OPTIONS, alwaysShow: true })).toBeNull();
  });

  it("shows the next car behind once the player is off track, across frames", () => {
    const m = newRejoinMemory();
    const off = frame({
      cars: [{ carIdx: 1 }, { carIdx: 2 }],
      gaps: [gap(1, 4.2), gap(2, 9)],
      player: { trackSurface: "offTrack", speedMps: 20 },
    });
    expect(rejoinView(off, m, 0, OPTIONS)).toBeNull();
    expect(rejoinView(off, m, 1, OPTIONS)).toEqual({
      tone: "yellow",
      gap: "4.2",
      condition: "CAUTION",
    });
  });

  it("is null while driving unless always shown", () => {
    const f = frame({ cars: [{ carIdx: 1 }], gaps: [gap(1, 1.2)] });
    expect(rejoinView(f, newRejoinMemory(), 0, OPTIONS)).toBeNull();
    expect(rejoinView(f, newRejoinMemory(), 0, { ...OPTIONS, alwaysShow: true })).toEqual({
      tone: "red",
      gap: "1.2",
      condition: "DO NOT REJOIN",
    });
  });

  it("has the design's red 1.4 s sample for edit mode", () => {
    expect(sampleRejoinView()).toEqual({ tone: "red", gap: "1.4", condition: "DO NOT REJOIN" });
  });
});
