import { describe, expect, it } from "vitest";
import { Deriver, type FixtureRecord, type TelemetryFrame } from "@overlay/sim-core";
import { ReplayRecordDecoder } from "./replay";
import { FIXTURES, IRACING_RACE_START, readRecords } from "./testing";

/**
 * Per-frame cost of the replay path (record to SimState to Derived) on the committed slices.
 * The first 100 frames are warm-up and YAML parses are not counted (they run in a worker in
 * production). The tests fail only at 3x the targets, because CI machines are noisy; the real
 * numbers are printed.
 */
const SKIP_FRAMES = 100;
const CI_FACTOR = 3;
const LMU_SLICE = `${FIXTURES}lmu-burst-first-5s.ovfx`;

interface Stats {
  median: number;
  p95: number;
  frames: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;
}

function measure(records: FixtureRecord[]): { stats: Stats; lastFrame: TelemetryFrame } {
  const decoder = new ReplayRecordDecoder();
  const deriver = new Deriver();
  const times: number[] = [];
  let frames = 0;
  let last: TelemetryFrame | undefined;
  for (const record of records) {
    const start = performance.now();
    const sourceFrame = decoder.accept(record);
    if (!sourceFrame) continue; // headers and YAML parses are not frames
    const derived = deriver.next(sourceFrame.state);
    const elapsed = performance.now() - start;
    frames++;
    last = {
      seq: frames,
      source: "replay",
      status: "live",
      error: null,
      state: sourceFrame.state,
      derived,
    };
    if (frames > SKIP_FRAMES) times.push(elapsed);
  }
  times.sort((a, b) => a - b);
  if (last === undefined) throw new Error("no frames");
  return {
    stats: { median: percentile(times, 0.5), p95: percentile(times, 0.95), frames: times.length },
    lastFrame: last,
  };
}

describe("replay frame cost", () => {
  it("iRacing: median under 2 ms, p95 under 4 ms (fails at 3x)", async () => {
    const { stats } = measure(await readRecords(IRACING_RACE_START));
    console.log(
      `iRacing ${stats.frames} frames: median ${stats.median.toFixed(3)} ms, p95 ${stats.p95.toFixed(3)} ms (targets 2 / 4)`,
    );
    expect(stats.frames).toBeGreaterThan(500);
    expect(stats.median).toBeLessThan(2 * CI_FACTOR);
    expect(stats.p95).toBeLessThan(4 * CI_FACTOR);
  });

  it("LMU: median under 3 ms, p95 under 6 ms (fails at 3x)", async () => {
    const { stats } = measure(await readRecords(LMU_SLICE));
    console.log(
      `LMU ${stats.frames} frames: median ${stats.median.toFixed(3)} ms, p95 ${stats.p95.toFixed(3)} ms (targets 3 / 6)`,
    );
    expect(stats.frames).toBeGreaterThan(100);
    expect(stats.median).toBeLessThan(3 * CI_FACTOR);
    expect(stats.p95).toBeLessThan(6 * CI_FACTOR);
  });

  it("structuredClone of one frame takes under 0.5 ms (fails at 3x)", async () => {
    const iracingFrame = measure(await readRecords(IRACING_RACE_START)).lastFrame;
    const lmuFrame = measure(await readRecords(LMU_SLICE)).lastFrame;
    for (const [name, frame] of [
      ["iRacing", iracingFrame],
      ["LMU", lmuFrame],
    ] as const) {
      for (let i = 0; i < 50; i++) structuredClone(frame);
      const times: number[] = [];
      for (let i = 0; i < 200; i++) {
        const start = performance.now();
        structuredClone(frame);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const median = percentile(times, 0.5);
      console.log(`structuredClone ${name}: median ${median.toFixed(3)} ms (target 0.5)`);
      expect(median).toBeLessThan(0.5 * CI_FACTOR);
    }
  });
});
