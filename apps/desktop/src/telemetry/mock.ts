import { MockSource } from "@overlay/sim-core";
import type { SourceFrame, TelemetrySource } from "./source";

/** Fixed simulated step per frame, so the output is the same on every run. */
const STEP_S = 1 / 60;

/** Synthetic 60 Hz field for UI work without a sim. */
export class MockTelemetrySource implements TelemetrySource {
  readonly id = "mock";
  readonly pollIntervalMs = 1000 * STEP_S;
  private readonly mock = new MockSource();

  async read(): Promise<SourceFrame | null> {
    return { state: this.mock.step(STEP_S) };
  }

  close(): void {}
}
