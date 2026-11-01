/**
 * Browser-safe demo telemetry for the settings preview (`@overlay/sim-core/demo`).
 * Must stay free of `node:` modules and adapters; a test checks the import graph (MW-2).
 * Owned by MW-2; this stub returns empty frames.
 */
import { emptySimState } from "./model";
import { emptyDerived, type TelemetryFrame } from "./telemetry/frame";

export interface DemoFeedOptions {
  /** Laps simulated at creation so lap times, gaps and fuel averages have values. Default 3. */
  warmUpLaps?: number;
}

export interface DemoFeed {
  /** Advances the simulation by `dtS` seconds and returns the next frame (`seq` counts up). */
  next(dtS: number): TelemetryFrame;
}

/** Stub: returns empty "waiting" frames. The real feed (MockSource + Deriver) arrives with MW-2. */
export function createDemoFeed(options: DemoFeedOptions = {}): DemoFeed {
  void options;
  let seq = 0;
  return {
    next: () => ({
      seq: ++seq,
      source: "mock",
      status: "waiting",
      error: null,
      state: emptySimState("mock"),
      derived: emptyDerived(),
    }),
  };
}
