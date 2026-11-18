import { describe, expect, it } from "vitest";
import { scriptStates } from "./script";

describe("scriptStates", () => {
  it("steps the clock at the tick and counts laps", () => {
    const states = scriptStates([{ lapTimeS: 10 }, { lapTimeS: 10 }], {
      sim: "lmu",
      sessionType: "practice",
    });
    expect(states[0]!.tickTimeS).toBe(0);
    expect(states[1]!.tickTimeS).toBeCloseTo(0.1, 9);
    const lap = (i: number) => states[i]!.cars[0]!.lapsCompleted;
    expect(lap(0)).toBe(0);
    expect(lap(99)).toBe(0);
    expect(lap(100)).toBe(1);
    expect(lap(200)).toBe(2);
    expect(states[100]!.player.lap?.currentLapS).toBeCloseTo(0, 6);
  });

  it("makes elapsed time follow the speed profile", () => {
    const fast = scriptStates([{ lapTimeS: 100, speedAt: (p) => (p < 0.5 ? 2 : 1) }], {
      sim: "lmu",
      sessionType: "practice",
      tickS: 1,
    });
    // The first half is twice as fast: it takes a third of the lap.
    const half = fast.findIndex((s) => (s.cars[0]!.lapDistPct ?? 0) >= 0.5);
    expect(half).toBeGreaterThanOrEqual(33);
    expect(half).toBeLessThanOrEqual(35);
    expect(fast[10]!.player.speedMps!).toBeCloseTo(2 * fast[60]!.player.speedMps!, 1);
  });

  it("reports the last lap time after the delay, and none for an invalid lap", () => {
    const states = scriptStates(
      [{ lapTimeS: 10 }, { lapTimeS: 10, invalid: true }, { lapTimeS: 9 }],
      { sim: "iracing", sessionType: "practice", lapTimeDelayS: 1 },
    );
    const at = (t: number) => states[Math.round(t * 10)]!.player.lap!;
    expect(at(10.5).lastLapS).toBeNull();
    expect(at(11).lastLapS).toBe(10);
    expect(at(21).lastLapS).toBeNull();
    expect(at(30).lastLapS).toBe(9);
    expect(at(30).bestLapS).toBe(9);
  });

  it("applies incident, off-track and pit windows; LMU reports none of the first two", () => {
    const lap = {
      lapTimeS: 10,
      incidentAtPct: 0.5,
      offTrack: [0.2, 0.3] as [number, number],
      pitRoad: [0.8, 0.9] as [number, number],
    };
    const ir = scriptStates([lap], { sim: "iracing", sessionType: "practice" });
    expect(ir[25]!.player.trackSurface).toBe("offTrack");
    expect(ir[40]!.player.incidentCount).toBe(0);
    expect(ir[60]!.player.incidentCount).toBe(1);
    expect(ir[85]!.cars[0]!.onPitRoad).toBe(true);
    const lmu = scriptStates([lap], { sim: "lmu", sessionType: "practice" });
    expect(lmu[25]!.player.trackSurface).toBeNull();
    expect(lmu[60]!.player.incidentCount).toBeNull();
    expect(lmu[85]!.cars[0]!.onPitRoad).toBe(true);
    expect(lmu[25]!.player.lap?.delta).toBeNull();
  });

  it("gives iRacing channels against the script's own laps, ok after 2 s", () => {
    const states = scriptStates([{ lapTimeS: 10 }, { lapTimeS: 9 }, { lapTimeS: 10 }], {
      sim: "iracing",
      sessionType: "practice",
    });
    const d = (t: number) => states[Math.round(t * 10)]!.player.lap!.delta!;
    expect(d(5).best!.ok).toBe(false); // no earlier lap
    expect(d(19.5).sessionLast!.ok).toBe(false); // under 2 s into lap 3
    expect(d(21).sessionLast!.ok).toBe(true);
    // Lap 3 (10 s) against the best (9 s) at 2 s in: 2 - 1.8.
    expect(d(21).best!.s).toBeCloseTo(0.2, 2);
    expect(d(21).best!.rate!).toBeGreaterThan(0);
  });
});
