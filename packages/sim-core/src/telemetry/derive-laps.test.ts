import { describe, expect, it } from "vitest";
import { Deriver } from "./derive";
import type { Derived } from "./frame";
import { MockSource } from "./mock";

/** Runs the demo race through the real Deriver and returns the last derived values. */
function runMock(seconds: number): Derived {
  const mock = new MockSource();
  const deriver = new Deriver();
  let derived: Derived | null = null;
  for (let i = 0; i < seconds * 10; i++) derived = deriver.next(mock.step(0.1));
  return derived!;
}

describe("Deriver lap history", () => {
  // The demo player starts 0.24 laps in; lap n completes at about 76 + 100 (n - 1) s.
  const laps = runMock(890).laps!;

  it("follows the player through the demo laps, newest first", () => {
    expect(laps.carIdx).toBe(0);
    expect(laps.laps.map((l) => l.lapNumber)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const times = [99.6, 99.5, 99.8, 100.3, 100.2, 99.6, 99.5, 99.8, 100.3];
    expect(laps.laps.map((l) => l.lapTimeS)).toEqual(times.map((t) => expect.closeTo(t, 6)));
  });

  it("keeps the unclean lap 3 out of the best", () => {
    const lap3 = laps.laps.find((l) => l.lapNumber === 3)!;
    expect(lap3.valid).toBe(false);
    expect(laps.bestLapNumber).toBe(8);
    expect(laps.bestLapS).toBeCloseTo(99.5, 6);
  });

  it("has the track temperature, the fuel used and the four sector times of each lap", () => {
    const lap = laps.laps[0]!;
    // The demo track temperature drifts a little, so the laps differ.
    expect(lap.trackTempC).toBeGreaterThan(31);
    expect(new Set(laps.laps.map((l) => l.trackTempC)).size).toBeGreaterThan(1);
    expect(lap.fuelUsedL).toBeCloseTo(2.4, 1);
    expect(lap.sectorTimes).toHaveLength(4);
    expect(lap.sectorTimes!.every((t) => t !== null && t > 0)).toBe(true);
    expect(laps.optimalLapS).not.toBeNull();
    expect(laps.optimalLapS!).toBeLessThanOrEqual(laps.bestLapS! + 0.01);
  });
});
