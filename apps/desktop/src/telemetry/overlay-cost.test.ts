import { describe, expect, it } from "vitest";
import { Deriver, MockSource, type FixtureRecord, type SimState } from "@overlay/sim-core";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import {
  fuelView,
  leaderboardView,
  newSpotterMemory,
  pitSpeedView,
  relativeView,
  spotterView,
} from "@overlay/overlays/views";
import { ReplayRecordDecoder } from "./replay";
import { FIXTURES, IRACING_RACE_START, LMU_ON_PACE, readRecords } from "./testing";

/**
 * Offline CPU cost of the work behind the M2 overlays (the in-app "Measure CPU" check covers the
 * whole app): `Deriver.next` (standings, proximity, fuel and the rest) on the committed slices
 * and on a 60-car mock field, and each overlay's view selector over 60-car mock frames. The
 * first frames are warm-up. The tests fail only at 3x the targets, because CI machines are
 * noisy; the real numbers are printed.
 */
const WARMUP = 20;
const CI_FACTOR = 3;
const CARS = 60;
const MOCK_FRAMES = 600;
const LMU_SLICE = `${FIXTURES}lmu-burst-first-5s.ovfx`;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN;
}

interface Stats {
  median: number;
  p95: number;
  n: number;
}

function stats(times: number[]): Stats {
  const sorted = [...times].sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), n: sorted.length };
}

function statesOf(records: FixtureRecord[]): SimState[] {
  const decoder = new ReplayRecordDecoder();
  const states: SimState[] = [];
  for (const record of records) {
    const frame = decoder.accept(record);
    if (frame !== null) states.push(frame.state);
  }
  return states;
}

function timeDeriver(states: SimState[]): Stats {
  // A throwaway pass first, so the code is compiled and the allocator is warm.
  const warm = new Deriver();
  for (const s of states.slice(0, WARMUP * 2)) warm.next(s);
  const deriver = new Deriver();
  const times: number[] = [];
  states.forEach((state, i) => {
    const start = performance.now();
    deriver.next(state);
    if (i >= WARMUP) times.push(performance.now() - start);
  });
  return stats(times);
}

function mockFrames(): TelemetryFrame[] {
  const mock = new MockSource({ carCount: CARS });
  const deriver = new Deriver();
  const frames: TelemetryFrame[] = [];
  for (let i = 0; i < MOCK_FRAMES; i++) {
    const state = mock.step(1 / 60);
    frames.push({
      seq: i + 1,
      source: "mock",
      status: "live",
      error: null,
      state,
      derived: deriver.next(state),
    });
  }
  return frames;
}

describe("Deriver.next cost", () => {
  // Targets: median 1 ms, p95 2 ms per frame (the engine budget for deriving at 60 Hz).
  it("iRacing slice: median under 1 ms, p95 under 2 ms (fails at 3x)", async () => {
    const s = timeDeriver(statesOf(await readRecords(IRACING_RACE_START)));
    console.log(
      `Deriver.next iRacing slice ${s.n} frames: median ${s.median.toFixed(3)} ms, p95 ${s.p95.toFixed(3)} ms (targets 1 / 2)`,
    );
    expect(s.n).toBeGreaterThan(500);
    expect(s.median).toBeLessThan(1 * CI_FACTOR);
    expect(s.p95).toBeLessThan(2 * CI_FACTOR);
  }, 60_000);

  it("LMU slices: median under 1 ms, p95 under 2 ms (fails at 3x)", async () => {
    const burst = timeDeriver(statesOf(await readRecords(LMU_SLICE)));
    const onPace = timeDeriver(statesOf(await readRecords(LMU_ON_PACE)));
    for (const [name, s] of [
      ["burst", burst],
      ["on-pace", onPace],
    ] as const) {
      console.log(
        `Deriver.next LMU ${name} ${s.n} frames: median ${s.median.toFixed(3)} ms, p95 ${s.p95.toFixed(3)} ms (targets 1 / 2)`,
      );
      expect(s.median).toBeLessThan(1 * CI_FACTOR);
      expect(s.p95).toBeLessThan(2 * CI_FACTOR);
    }
  }, 60_000);

  it(`${CARS}-car mock field: median under 2 ms, p95 under 4 ms (fails at 3x)`, () => {
    const mock = new MockSource({ carCount: CARS });
    const states = Array.from({ length: MOCK_FRAMES }, () => mock.step(1 / 60));
    const s = timeDeriver(states);
    console.log(
      `Deriver.next ${CARS}-car mock ${s.n} frames: median ${s.median.toFixed(3)} ms, p95 ${s.p95.toFixed(3)} ms (targets 2 / 4)`,
    );
    expect(s.median).toBeLessThan(2 * CI_FACTOR);
    expect(s.p95).toBeLessThan(4 * CI_FACTOR);
  });
});

describe(`overlay view selectors over ${CARS}-car mock frames`, () => {
  const table = { livePositions: true, gapDecimals: 1, lapDecimals: 3 } as const;
  const selectors: Record<string, { target: number; run(frames: TelemetryFrame[]): void }> = {
    leaderboard: {
      target: 0.5,
      run: (frames) => {
        const options = {
          ...table,
          showAll: false,
          around: 3,
          topMyClass: 3,
          topOtherClasses: 3,
        };
        for (const f of frames) leaderboardView(f, options);
      },
    },
    relative: {
      target: 0.5,
      run: (frames) => {
        const options = {
          ...table,
          ahead: 3,
          behind: 3,
          hideInPits: false,
          gapThreat: true,
        };
        let previous = relativeView(null, options).rows;
        for (const f of frames) previous = relativeView(f, options, previous).rows;
      },
    },
    spotter: {
      target: 0.05,
      run: (frames) => {
        const memory = newSpotterMemory();
        frames.forEach((f, i) => spotterView(f, memory, i * 16));
      },
    },
    "pit-speed": {
      target: 0.05,
      run: (frames) => {
        for (const f of frames) pitSpeedView(f);
      },
    },
    fuel: {
      target: 0.1,
      run: (frames) => {
        for (const f of frames) fuelView(f, { safetyMarginLaps: 1, liveUpdates: true });
      },
    },
  };

  it("each selector stays under its median target (fails at 3x)", () => {
    const frames = mockFrames();
    expect(frames[0]?.state.cars).toHaveLength(CARS);
    for (const [name, { target, run }] of Object.entries(selectors)) {
      // Per-call time: run the whole sequence several times and divide.
      run(frames.slice(0, WARMUP * 5));
      const rounds: number[] = [];
      for (let round = 0; round < 15; round++) {
        const start = performance.now();
        run(frames);
        rounds.push((performance.now() - start) / frames.length);
      }
      const s = stats(rounds);
      console.log(
        `${name} selector (${CARS} cars): median ${s.median.toFixed(4)} ms/frame, p95 ${s.p95.toFixed(4)} ms (target ${target})`,
      );
      expect(s.median).toBeLessThan(target * CI_FACTOR);
    }
  });
});
