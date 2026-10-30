import { createReadStream } from "node:fs";
import { describe, expect, it } from "vitest";
import { FixtureReader } from "../../fixtures";
import { FuelTracker } from "./index";
import { IracingFuelSampler } from "./testHelpers";

const path = process.env["OVERLAY_IRACING_RECORDING"];
const RACE_SESSION_NUM = 2;

describe("local iRacing recording (Ferrari 296 GT3)", () => {
  it.skipIf(!path)(
    "tracks fuel over the 12-lap race",
    async () => {
      const reader = new FixtureReader(createReadStream(path as string));
      const sampler = new IracingFuelSampler();
      const tracker = new FuelTracker();
      let samples = 0;
      for await (const record of reader.records()) {
        const s = sampler.accept(record, (n) => (n === RACE_SESSION_NUM ? "Race" : "Other"));
        if (s === null || s.sessionNum !== RACE_SESSION_NUM) continue;
        tracker.update(s);
        samples++;
      }
      const out = tracker.snapshot({ lapsToGo: null });
      const reasons = tracker.lapRecords.map((l) => l.reason ?? "ok").join(",");
      console.log(
        `race samples=${samples} laps=${tracker.lapRecords.length} valid=${out.validLapCount} ` +
          `fuelAvgLap=${out.fuelAvgLap} fuelMaxLap=${out.fuelMaxLap} reasons=[${reasons}]`,
      );
      expect(out.validLapCount).toBeGreaterThanOrEqual(9);
      expect(out.fuelAvgLap).toBeGreaterThan(1);
      expect(out.fuelAvgLap).toBeLessThan(6);
    },
    600_000,
  );
});
