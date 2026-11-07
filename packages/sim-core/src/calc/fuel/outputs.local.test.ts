import { createReadStream } from "node:fs";
import { describe, expect, it } from "vitest";
import { IracingAdapter } from "../../adapters/iracing/adapter";
import { decodeSessionYaml } from "../../adapters/iracing/decoder";
import { parseSessionYaml, type IracingSessionInfo } from "../../adapters/iracing/session-yaml";
import { LmuDecoder } from "../../adapters/lmu/decoder";
import { RecordKind } from "../../fixtures/format";
import { FixtureReader } from "../../fixtures/reader";
import type { SimState } from "../../model";
import { Deriver } from "../../telemetry/derive";
import type { FuelLapRecord, FuelOutputs } from "./index";

/**
 * Local only: set OVERLAY_LMU_RECORDING (Le Mans practice, 499P) and/or OVERLAY_IRACING_RECORDING.
 * Prints counts and averages only, never names.
 */
const lmuPath = process.env["OVERLAY_LMU_RECORDING"];
const iracingPath = process.env["OVERLAY_IRACING_RECORDING"];

async function* lmuStates(path: string): AsyncGenerator<SimState> {
  const decoder = new LmuDecoder();
  for await (const record of new FixtureReader(createReadStream(path)).records()) {
    if (record.kind === RecordKind.RestResponse) {
      decoder.observeRest(JSON.parse(record.payload.toString("utf8")));
    } else if (record.kind === RecordKind.LmuBuffer) {
      const result = decoder.decode(record.payload);
      if (result.error === null) yield result.state;
    }
  }
}

async function* iracingStates(path: string): AsyncGenerator<SimState> {
  let adapter: IracingAdapter | undefined;
  let info: IracingSessionInfo | null = null;
  for await (const record of new FixtureReader(createReadStream(path)).records()) {
    if (record.kind === RecordKind.IracingHeader) {
      adapter = IracingAdapter.fromHeaderBytes(record.payload);
    } else if (record.kind === RecordKind.IracingSessionYaml) {
      info = parseSessionYaml(decodeSessionYaml(record.payload));
    } else if (record.kind === RecordKind.IracingVarBuffer && adapter) {
      yield adapter.toSimState(record.payload.subarray(4), info);
    }
  }
}

function countReasons(records: readonly FuelLapRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of records)
    counts.set(r.reason ?? "valid", (counts.get(r.reason ?? "valid") ?? 0) + 1);
  return JSON.stringify([...counts]);
}

describe("fuel outputs on local recordings", () => {
  it.skipIf(!lmuPath)(
    "LMU virtual energy laps",
    async () => {
      const deriver = new Deriver();
      let last: FuelOutputs | null = null;
      let lastFuel: FuelOutputs | null = null;
      for await (const state of lmuStates(lmuPath as string)) {
        const out = deriver.next(state);
        if (out.energy !== null) last = out.energy;
        if (out.fuel !== null) lastFuel = out.fuel;
      }
      console.info(
        `LMU energy: valid=${last?.validLapCount} avg=${last?.fuelAvgLap?.toFixed(2)}% ` +
          `avg5=${last?.fuelAvg5Lap?.toFixed(2)}% perHour=${last?.fuelPerHour?.toFixed(1)}% ` +
          `reasons=${countReasons(deriver.energyTracker.lapRecords)}; ` +
          `fuel valid=${lastFuel?.validLapCount} avg=${lastFuel?.fuelAvgLap?.toFixed(2)} L`,
      );
      expect(last).not.toBeNull();
    },
    600_000,
  );

  it.skipIf(!iracingPath)(
    "iRacing fuel outputs",
    async () => {
      const deriver = new Deriver();
      let last: FuelOutputs | null = null;
      for await (const state of iracingStates(iracingPath as string)) {
        const out = deriver.next(state);
        if (out.fuel !== null) last = out.fuel;
      }
      console.info(
        `iRacing fuel: valid=${last?.validLapCount} avg=${last?.fuelAvgLap?.toFixed(3)} L ` +
          `avg5=${last?.fuelAvg5Lap?.toFixed(3)} avg10=${last?.fuelAvg10Lap?.toFixed(3)} ` +
          `perHour=${last?.fuelPerHour?.toFixed(1)} stintLaps=${last?.stintLaps} ` +
          `recent=${last?.recentLaps.length} lapTimes=${last?.recentLaps.filter((l) => l.lapTimeS !== null).length}; ` +
          `reasons=${countReasons(deriver.fuelTracker.lapRecords)}`,
      );
      expect(last).not.toBeNull();
    },
    600_000,
  );
});
