import { describe, expect, it } from "vitest";
import { LmuSectorLearner, lmuSectorIndex } from "./sectors";

/** Drives the learner along a lap: samples every `step` of lap fraction, sectors from `starts`. */
function drive(learner: LmuSectorLearner, starts: number[], step = 0.004, key = "Track|5000") {
  let out: number[] | null = null;
  for (let pct = 0; pct < 1; pct += step) {
    const index = starts.filter((s) => s <= pct).length - 1;
    const raw = index === 2 ? 0 : index + 1;
    out = learner.observe(key, raw, pct);
  }
  return out;
}

describe("lmuSectorIndex", () => {
  it("maps 1, 2, 0 to sectors 0, 1, 2 and anything else to null", () => {
    expect([1, 2, 0, 3, -1].map(lmuSectorIndex)).toEqual([0, 1, 2, null, null]);
  });
});

describe("LmuSectorLearner", () => {
  it("learns both boundaries on one lap, between the samples either side", () => {
    const learner = new LmuSectorLearner();
    const out = drive(learner, [0, 0.3, 0.71])!;
    expect(out[0]).toBe(0);
    expect(out[1]!).toBeCloseTo(0.3, 2);
    expect(out[2]!).toBeCloseTo(0.71, 2);
  });

  it("stays null until both boundaries are known", () => {
    const learner = new LmuSectorLearner();
    let out: number[] | null = null;
    for (let pct = 0; pct < 0.6; pct += 0.004) {
      out = learner.observe("T", pct < 0.3 ? 1 : 2, pct);
    }
    expect(out).toBeNull();
  });

  it("ignores a sector change that comes with a jump (teleport, tow)", () => {
    const learner = new LmuSectorLearner();
    learner.observe("T", 1, 0.1);
    expect(learner.observe("T", 2, 0.5)).toBeNull();
    learner.observe("T", 2, 0.6);
    expect(learner.observe("T", 0, 0.602)).toBeNull(); // only the second boundary is known
  });

  it("forgets what it learned when the track changes", () => {
    const learner = new LmuSectorLearner();
    expect(drive(learner, [0, 0.3, 0.7])).not.toBeNull();
    expect(learner.observe("Other|4000", 1, 0.01)).toBeNull();
    expect(learner.observe(null, 1, 0.02)).toBeNull();
  });

  it("keeps the learned starts while the sector is unknown", () => {
    const learner = new LmuSectorLearner();
    drive(learner, [0, 0.3, 0.7]);
    expect(learner.observe("Track|5000", -1, null)).not.toBeNull();
  });
});
