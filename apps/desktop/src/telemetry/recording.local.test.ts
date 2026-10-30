import { createReadStream } from "node:fs";
import { describe, expect, it } from "vitest";
import { Deriver, FixtureReader, type FuelOutputs } from "@overlay/sim-core";
import { ReplayRecordDecoder } from "./replay";

/**
 * Local-only: streams a whole raw iRacing recording through the replay decoder and the Deriver.
 * Set OVERLAY_IRACING_RECORDING to a copy of the Ferrari qualify + 12-lap race file. Cars are
 * only ever referred to by carIdx; the recording holds real drivers.
 */
const recording = process.env["OVERLAY_IRACING_RECORDING"];

describe("local iRacing recording through the telemetry core", () => {
  it.skipIf(!recording)(
    "derives fuel and gaps for the whole file within the frame budget",
    async () => {
      const reader = new FixtureReader(createReadStream(recording as string));
      const decoder = new ReplayRecordDecoder();
      const deriver = new Deriver();
      const times: number[] = [];
      let frames = 0;
      let lastFuel: FuelOutputs | null = null;
      let sessionResets = 0;
      let previousSession = deriver.sessionNum;
      for await (const record of reader.records()) {
        const start = performance.now();
        const frame = decoder.accept(record);
        if (!frame) continue;
        const derived = deriver.next(frame.state);
        const elapsed = performance.now() - start;
        frames++;
        if (frames > 100) times.push(elapsed);
        lastFuel = derived.fuel ?? lastFuel;
        if (deriver.sessionNum !== previousSession) {
          sessionResets++;
          previousSession = deriver.sessionNum;
        }
      }
      times.sort((a, b) => a - b);
      const at = (p: number): number => times[Math.floor(times.length * p)] ?? NaN;
      console.log(
        `frames ${frames}, median ${at(0.5).toFixed(3)} ms, p95 ${at(0.95).toFixed(3)} ms, ` +
          `p99 ${at(0.99).toFixed(3)} ms, session resets ${sessionResets}, ` +
          `valid laps ${lastFuel?.validLapCount}, fuelAvgLap ${lastFuel?.fuelAvgLap}`,
      );
      expect(frames).toBeGreaterThan(10_000);
      expect(at(0.5)).toBeLessThan(2);
      expect(at(0.95)).toBeLessThan(4);
      expect(sessionResets).toBeGreaterThanOrEqual(1);
      expect(lastFuel?.validLapCount).toBeGreaterThanOrEqual(10);
    },
    600_000,
  );
});
