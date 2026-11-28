import { describe, expect, it } from "vitest";
import { OPTIMAL_SECTORS, OptimalLap } from "./optimal";
import { LAP_TRACE_BINS, type LapTrace } from "./types";

/** First half takes `a` s, second half `b` s, each at constant speed. */
function twoHalves(a: number, b: number): LapTrace {
  const timeS = Array.from({ length: LAP_TRACE_BINS }, (_, k) => {
    const f = k / LAP_TRACE_BINS;
    return f < 0.5 ? f * 2 * a : a + (f - 0.5) * 2 * b;
  });
  return { timeS, speedMps: new Array<number>(LAP_TRACE_BINS).fill(50) };
}

describe("OptimalLap", () => {
  it("is null before the first lap", () => {
    expect(new OptimalLap().lapS).toBeNull();
    expect(OPTIMAL_SECTORS).toBe(20);
  });

  it("equals the lap time for one lap", () => {
    const o = new OptimalLap();
    o.addLap(twoHalves(40, 60), 100);
    expect(o.lapS).toBeCloseTo(100, 6);
  });

  it("sums the faster halves of two laps", () => {
    const o = new OptimalLap();
    o.addLap(twoHalves(40, 62), 102);
    o.addLap(twoHalves(43, 58), 101);
    expect(o.lapS).toBeCloseTo(40 + 58, 6);
  });

  it("ignores broken traces and resets", () => {
    const o = new OptimalLap();
    o.addLap({ timeS: [0, 1], speedMps: [1, 1] }, 100);
    o.addLap(twoHalves(40, 60), Number.NaN);
    expect(o.lapS).toBeNull();
    o.addLap(twoHalves(40, 60), 100);
    o.reset();
    expect(o.lapS).toBeNull();
  });
});
