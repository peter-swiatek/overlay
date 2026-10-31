import { createReadStream } from "node:fs";
import { describe, expect, it } from "vitest";
import { RecordKind } from "../../fixtures/format";
import { FixtureReader } from "../../fixtures/reader";
import { LmuDecoder } from "./decoder";

// Local only: point OVERLAY_LMU_RECORDING at a copy of the Le Mans recording. Prints counts and
// ranges only, never names.
const path = process.env["OVERLAY_LMU_RECORDING"];

interface Range {
  n: number;
  min: number;
  max: number;
}

function widen(r: Range, v: number): void {
  r.n++;
  r.min = Math.min(r.min, v);
  r.max = Math.max(r.max, v);
}

const range = (): Range => ({ n: 0, min: Infinity, max: -Infinity });

function record(body: unknown): Record<string, unknown> | null {
  const parsed = typeof body === "string" ? safeJson(body) : body;
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

describe("LMU field data on the full recording", () => {
  it.skipIf(!path)(
    "fills worldPos, fuelFraction, time of day and brake bias and agrees with REST",
    async () => {
      const reader = new FixtureReader(createReadStream(path as string));
      const decoder = new LmuDecoder();
      let frames = 0;
      let cars = 0;
      let withPos = 0;
      let withFuel = 0;
      let withTeam = 0;
      let todFrames = 0;
      let biasFrames = 0;
      const tod = range();
      const bias = range();
      const fuel = range();
      // REST comparisons, each against the first frame decoded after the REST body.
      let standingsPending: Map<number, number> | null = null;
      let fuelFrames = 0;
      let fuelCarsCompared = 0;
      let fuelCarsAgreeing = 0;
      let framesAllAgree = 0;
      let todPending: number | null = null;
      let todPairs = 0;
      let todWithin3s = 0;
      let playerFuelPairs = 0;
      let playerTracksFuel = 0;
      let playerTracksEnergy = 0;

      for await (const rec of reader.records()) {
        if (rec.kind === RecordKind.RestResponse) {
          const rest = JSON.parse(rec.payload.toString("utf8")) as {
            path: string;
            body: unknown;
          };
          decoder.observeRest(rest);
          if (rest.path === "/rest/watch/standings") {
            const parsed = typeof rest.body === "string" ? safeJson(rest.body) : rest.body;
            if (Array.isArray(parsed)) {
              standingsPending = new Map();
              for (const e of parsed as Record<string, unknown>[]) {
                if (typeof e["slotID"] === "number" && typeof e["fuelFraction"] === "number") {
                  standingsPending.set(e["slotID"], e["fuelFraction"]);
                }
              }
            }
          } else if (rest.path === "/rest/sessions/GetGameState") {
            const t = record(rest.body)?.["timeOfDay"];
            if (typeof t === "number") todPending = t;
          }
          continue;
        }
        if (rec.kind !== RecordKind.LmuBuffer) continue;
        const { state, error } = decoder.decode(rec.payload);
        if (error !== null) continue;
        frames++;
        for (const car of state.cars) {
          cars++;
          if (car.worldPos !== null) withPos++;
          if (car.fuelFraction !== null) {
            withFuel++;
            widen(fuel, car.fuelFraction);
          }
          if (car.teamName !== null) withTeam++;
        }
        if (state.session.timeOfDayS !== null) {
          todFrames++;
          widen(tod, state.session.timeOfDayS);
        }
        if (state.player.brakeBias !== null) {
          biasFrames++;
          widen(bias, state.player.brakeBias);
        }
        if (standingsPending !== null) {
          let compared = 0;
          let agreeing = 0;
          for (const car of state.cars) {
            const expected = standingsPending.get(car.carIdx);
            if (expected === undefined || car.fuelFraction === null) continue;
            compared++;
            if (Math.abs(car.fuelFraction - expected) < 1e-6) agreeing++;
          }
          fuelFrames++;
          fuelCarsCompared += compared;
          fuelCarsAgreeing += agreeing;
          if (compared > 0 && agreeing === compared) framesAllAgree++;
          standingsPending = null;
        }
        if (todPending !== null && state.session.timeOfDayS !== null) {
          todPairs++;
          if (Math.abs(state.session.timeOfDayS - (todPending % 86_400)) < 3) todWithin3s++;
          todPending = null;
        }
        const { fuelL, fuelCapacityL, energyFraction } = state.player;
        const player = state.cars.find((c) => c.isPlayer);
        if (player?.fuelFraction != null && fuelL !== null && fuelCapacityL) {
          playerFuelPairs++;
          const byFuel = Math.abs(player.fuelFraction - fuelL / fuelCapacityL);
          if (byFuel < 0.02) playerTracksFuel++;
          if (energyFraction !== null && Math.abs(player.fuelFraction - energyFraction) < byFuel) {
            playerTracksEnergy++;
          }
        }
      }

      const pct = (a: number, b: number): string =>
        b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`;
      const fmt = (r: Range): string => `${r.min.toFixed(4)}..${r.max.toFixed(4)}`;
      console.info(
        [
          `LMU field data: ${frames} frames, ${cars} car rows`,
          `worldPos ${pct(withPos, cars)} of rows, fuelFraction ${pct(withFuel, cars)} (${fmt(fuel)}), teamName ${pct(withTeam, cars)}`,
          `timeOfDayS in ${todFrames} frames (${fmt(tod)}); brakeBias in ${biasFrames} frames (${fmt(bias)})`,
          `fuelFraction vs REST: ${fuelFrames} paired frames, ${pct(fuelCarsAgreeing, fuelCarsCompared)} of ${fuelCarsCompared} cars exact, ${pct(framesAllAgree, fuelFrames)} of frames fully agree`,
          `timeOfDayS within 3 s of REST: ${todWithin3s} of ${todPairs}`,
          `player fuelFraction within 0.02 of fuelL/capacity: ${playerTracksFuel} of ${playerFuelPairs}; closer to energy than to fuel: ${playerTracksEnergy}`,
        ].join("\n"),
      );
      expect(frames).toBeGreaterThan(1000);
      expect(withPos).toBe(cars);
      expect(withFuel).toBe(cars);
      // REST and the buffer are sampled up to a tick apart, so a byte can be one count off.
      expect(fuelCarsAgreeing).toBeGreaterThan(fuelCarsCompared * 0.999);
      expect(todWithin3s).toBe(todPairs);
    },
    600_000,
  );
});
