import { describe, expect, it } from "vitest";
import { StandingsTracker } from "./index";
import { linearReference, mkInputs, mkState } from "./testHelpers";

/** Target 0.2 ms median per call for 60 cars; fails only at 3x because CI machines are noisy. */
const TARGET_MS = 0.2;
const CI_FACTOR = 3;

describe("standings performance", () => {
  it("stays under budget for 60 cars", () => {
    const ref = linearReference(90);
    const inputs = mkInputs({
      carReference: () => ref,
      averageLapS: () => 91,
      bestLapS: () => 90,
    });
    const t = new StandingsTracker();
    const times: number[] = [];
    for (let f = 0; f < 700; f++) {
      const cars = Array.from({ length: 60 }, (_, i) => ({
        carIdx: i,
        classId: String(i % 3),
        position: i + 1,
        iRating: 1500 + i * 20,
        lapsCompleted: 5,
        lapDistPct: ((60 - i) * 0.013 + f * 0.0003) % 1,
        onPitRoad: false,
        bestLapS: 90 + i * 0.1,
      }));
      const state = mkState(cars);
      const t0 = performance.now();
      t.next(state, inputs);
      times.push(performance.now() - t0);
    }
    const sorted = times.slice(100).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? NaN;
    console.log(`standings next(): median ${median.toFixed(3)} ms for 60 cars`);
    expect(median).toBeLessThan(TARGET_MS * CI_FACTOR);
  });
});
