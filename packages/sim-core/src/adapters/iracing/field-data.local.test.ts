import { createReadStream } from "node:fs";
import { describe, expect, it } from "vitest";
import { RecordKind } from "../../fixtures/format";
import { FixtureReader } from "../../fixtures/reader";
import { IracingAdapter } from "./adapter";
import { decodeSessionYaml } from "./decoder";
import { parseSessionYaml, type IracingSessionInfo } from "./session-yaml";

// Local only: point OVERLAY_IRACING_RECORDING at a copy of a recording. Prints counts and ranges
// only, never names.
const path = process.env["OVERLAY_IRACING_RECORDING"];

interface Range {
  n: number;
  min: number;
  max: number;
}

const FIELDS = [
  "session.timeOfDayS",
  "session.incidentLimit",
  "conditions.precipitation",
  "conditions.humidity",
  "conditions.fogLevel",
  "conditions.windSpeedMps",
  "conditions.windDirRad",
  "player.pitStallLapDistPct",
  "player.brakeBias",
] as const;

function pick(state: ReturnType<IracingAdapter["toSimState"]>, field: (typeof FIELDS)[number]) {
  switch (field) {
    case "session.timeOfDayS":
      return state.session.timeOfDayS;
    case "session.incidentLimit":
      return state.session.incidentLimit;
    case "conditions.precipitation":
      return state.conditions.precipitation;
    case "conditions.humidity":
      return state.conditions.humidity;
    case "conditions.fogLevel":
      return state.conditions.fogLevel;
    case "conditions.windSpeedMps":
      return state.conditions.windSpeedMps;
    case "conditions.windDirRad":
      return state.conditions.windDirRad;
    case "player.pitStallLapDistPct":
      return state.player.pitStallLapDistPct;
    case "player.brakeBias":
      return state.player.brakeBias;
  }
}

describe("iRacing field data on a full recording", () => {
  it.skipIf(!path)(
    "counts non-null frames and value ranges for the new fields",
    async () => {
      const reader = new FixtureReader(createReadStream(path as string));
      let adapter: IracingAdapter | null = null;
      let info: IracingSessionInfo | null = null;
      let frames = 0;
      let carRows = 0;
      let teamRows = 0;
      let worldPosRows = 0;
      let fuelRows = 0;
      const ranges = new Map<string, Range>(
        FIELDS.map((f) => [f, { n: 0, min: Infinity, max: -Infinity }]),
      );
      for await (const rec of reader.records()) {
        if (rec.kind === RecordKind.IracingHeader)
          adapter = IracingAdapter.fromHeaderBytes(rec.payload);
        else if (rec.kind === RecordKind.IracingSessionYaml) {
          info = parseSessionYaml(decodeSessionYaml(rec.payload));
        } else if (rec.kind === RecordKind.IracingVarBuffer && adapter !== null) {
          const state = adapter.toSimState(rec.payload.subarray(4), info);
          frames++;
          for (const f of FIELDS) {
            const v = pick(state, f);
            const r = ranges.get(f);
            if (v === null || r === undefined) continue;
            r.n++;
            r.min = Math.min(r.min, v);
            r.max = Math.max(r.max, v);
          }
          for (const c of state.cars) {
            carRows++;
            if (c.teamName !== null) teamRows++;
            if (c.worldPos !== null) worldPosRows++;
            if (c.fuelFraction !== null) fuelRows++;
          }
        }
      }
      const lines = FIELDS.map((f) => {
        const r = ranges.get(f) as Range;
        return `${f}: ${r.n}/${frames} frames${r.n > 0 ? `, ${r.min.toFixed(4)}..${r.max.toFixed(4)}` : ""}`;
      });
      console.info(
        [
          `iRacing field data: ${frames} frames`,
          ...lines,
          `teamName ${teamRows}/${carRows} car rows; worldPos ${worldPosRows}; fuelFraction ${fuelRows}`,
        ].join("\n"),
      );
      expect(frames).toBeGreaterThan(1000);
      expect(worldPosRows).toBe(0);
      expect(fuelRows).toBe(0);
      expect(teamRows).toBeGreaterThan(0);
      for (const f of ["conditions.precipitation", "conditions.humidity", "conditions.fogLevel"]) {
        const r = ranges.get(f) as Range;
        if (r.n > 0) {
          expect(r.min).toBeGreaterThanOrEqual(0);
          expect(r.max).toBeLessThanOrEqual(1);
        }
      }
      const dir = ranges.get("conditions.windDirRad") as Range;
      if (dir.n > 0) expect(dir.max).toBeLessThan(2 * Math.PI);
    },
    600_000,
  );
});
