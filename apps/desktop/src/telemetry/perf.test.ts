import { describe, expect, it } from "vitest";
import type { FixtureRecord, TelemetryFrame } from "@overlay/sim-core";
import { TelemetryEngine } from "./engine";
import { ReplayTelemetrySource } from "./replay";
import type { TelemetrySource } from "./source";
import { FIXTURES, IRACING_RACE_START, readRecords } from "./testing";

/**
 * Per-frame cost of the replay path on the committed slices: ReplayTelemetrySource driven by the
 * real engine. Each frame is timed from the start of `read()` to its publication (decoding,
 * deriving, emitting), so file IO and the engine's timers are left out. The first 100 frames are
 * warm-up and YAML parses are not counted (production runs them in a worker). The tests fail only
 * at 3x the targets, because CI machines are noisy; the real numbers are printed.
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

async function measure(
  records: FixtureRecord[],
): Promise<{ stats: Stats; lastFrame: TelemetryFrame }> {
  const inner = ReplayTelemetrySource.fromRecords(records);
  const times: number[] = [];
  let startedAt = 0;
  let parsedYaml = false;
  let frames = 0;
  let last: TelemetryFrame | undefined;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (finish = resolve));

  const timed: TelemetrySource = {
    id: "replay",
    pollIntervalMs: 0,
    get ended() {
      return inner.ended;
    },
    async read() {
      startedAt = performance.now();
      const before = inner.decoder.yamlParses;
      const frame = await inner.read();
      parsedYaml = inner.decoder.yamlParses !== before;
      return frame;
    },
    close: () => inner.close(),
  };
  const engine = new TelemetryEngine({
    live: {},
    createReplay: () => timed,
    createMock: () => timed,
    publish: (frame) => {
      if (frame.status === "waiting") return finish();
      const elapsed = performance.now() - startedAt;
      frames++;
      last = frame;
      if (frames > SKIP_FRAMES && !parsedYaml) times.push(elapsed);
    },
  });
  engine.setSource({ source: "replay", replayPath: "in-memory" });
  engine.start();
  await done;
  engine.stop();
  times.sort((a, b) => a - b);
  if (last === undefined) throw new Error("no frames");
  return {
    stats: { median: percentile(times, 0.5), p95: percentile(times, 0.95), frames: times.length },
    lastFrame: last,
  };
}

describe("replay frame cost (replay source through the engine)", () => {
  it("iRacing: median under 2 ms, p95 under 4 ms (fails at 3x)", async () => {
    const { stats } = await measure(await readRecords(IRACING_RACE_START));
    console.log(
      `iRacing ${stats.frames} frames: median ${stats.median.toFixed(3)} ms, p95 ${stats.p95.toFixed(3)} ms (targets 2 / 4)`,
    );
    expect(stats.frames).toBeGreaterThan(500);
    expect(stats.median).toBeLessThan(2 * CI_FACTOR);
    expect(stats.p95).toBeLessThan(4 * CI_FACTOR);
  }, 60_000);

  it("LMU: median under 3 ms, p95 under 6 ms (fails at 3x)", async () => {
    const { stats } = await measure(await readRecords(LMU_SLICE));
    console.log(
      `LMU ${stats.frames} frames: median ${stats.median.toFixed(3)} ms, p95 ${stats.p95.toFixed(3)} ms (targets 3 / 6)`,
    );
    expect(stats.frames).toBeGreaterThan(100);
    expect(stats.median).toBeLessThan(3 * CI_FACTOR);
    expect(stats.p95).toBeLessThan(6 * CI_FACTOR);
  }, 60_000);

  it("structuredClone of one frame takes under 0.5 ms (fails at 3x)", async () => {
    const iracingFrame = (await measure(await readRecords(IRACING_RACE_START))).lastFrame;
    const lmuFrame = (await measure(await readRecords(LMU_SLICE))).lastFrame;
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
  }, 60_000);
});
