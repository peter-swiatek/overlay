import { describe, expect, it } from "vitest";
import {
  buildLogHeader,
  fieldSlotsFor,
  OtlmWriter,
  readOtlm,
  TelemetrySampler,
  type SimState,
} from "@overlay/sim-core";
import { ReplayRecordDecoder } from "../telemetry/replay";
import { IRACING_RACE_START, readRecords } from "../telemetry/testing";

/**
 * Size of a tier 2 file per hour of driving, measured on real data: the 20 s race-start slice
 * (about 1,160 frames at 57 Hz, 62 cars) repeated until it covers 60 s, then extrapolated. The
 * loop shifts the clock so that time keeps rising.
 */
describe("tier 2 size", () => {
  it("restores every sampled channel of real frames to within its stored precision", async () => {
    const records = await readRecords(IRACING_RACE_START);
    const decoder = new ReplayRecordDecoder();
    const states: SimState[] = [];
    for (const record of records) {
      const frame = decoder.accept(record);
      if (frame) states.push(frame.state);
    }
    const first = states[0] as SimState;
    const chunks: Uint8Array[] = [];
    const slots = fieldSlotsFor(first);
    const writer = new OtlmWriter(
      { append: (b) => chunks.push(Buffer.from(b)) },
      buildLogHeader({ sessionId: "fidelity", sim: "iracing", startedAt: 0, fieldSlots: slots }),
    );
    const sampler = new TelemetrySampler(writer, slots);
    for (const state of states) sampler.accept(state);
    writer.close();
    const file = readOtlm(Buffer.concat(chunks));
    const player = file.groups["player"];
    const field = file.groups["field"];
    expect(player?.samples).toBeGreaterThan(1000);

    const byTime = new Map(states.map((s) => [Math.round((s.tickTimeS ?? 0) * 1000), s]));
    const col = (name: string): Float64Array => player?.channels[name] as Float64Array;
    let compared = 0;
    for (let i = 0; i < (player?.samples ?? 0); i++) {
      const state = byTime.get(Math.round((col("t")[i] as number) * 1000)) as SimState;
      const car = state.cars.find((c) => c.carIdx === state.playerCarIdx);
      expect(col("speed")[i]).toBeCloseTo(state.player.speedMps ?? NaN, 1);
      expect(col("throttle")[i]).toBeCloseTo(state.player.inputs.throttle ?? NaN, 2);
      expect(col("brake")[i]).toBeCloseTo(state.player.inputs.brake ?? NaN, 2);
      expect(col("steer")[i]).toBeCloseTo(state.player.inputs.steer ?? NaN, 2);
      expect(col("gear")[i]).toBe(state.player.gear);
      expect(
        Math.abs((col("rpm")[i] as number) - (state.player.rpm ?? Number.NaN)),
      ).toBeLessThanOrEqual(0.5);
      expect(col("lapDistPct")[i]).toBeCloseTo(car?.lapDistPct ?? Number.NaN, 4);
      expect(col("fuel")[i]).toBeCloseTo(state.player.fuelL ?? Number.NaN, 2);
      expect(col("lap")[i]).toBe(car?.lapsCompleted ?? -1);
      compared++;
    }
    expect(compared).toBe(player?.samples);
    // The field: every car's position and lap distance at the 4 Hz samples.
    const ft = field?.channels["t"] as Float64Array;
    for (let i = 0; i < (field?.samples ?? 0); i += 7) {
      const state = byTime.get(Math.round((ft[i] as number) * 1000)) as SimState;
      for (const car of state.cars.filter((c) => c.connected && c.carIdx < slots)) {
        expect(field?.channels["position"]?.[i * slots + car.carIdx]).toBe(car.position ?? 0);
        expect(field?.channels["lapDistPct"]?.[i * slots + car.carIdx]).toBeCloseTo(
          car.lapDistPct ?? Number.NaN,
          4,
        );
      }
    }
  });

  it("stays small enough to keep 60 days of racing", async () => {
    const records = await readRecords(IRACING_RACE_START);
    const decoder = new ReplayRecordDecoder();
    const slice: SimState[] = [];
    for (const record of records) {
      const frame = decoder.accept(record);
      if (frame) slice.push(frame.state);
    }
    const first = slice[0] as SimState;
    const lengthS = (slice[slice.length - 1]?.tickTimeS ?? 0) - (first.tickTimeS ?? 0);
    expect(lengthS).toBeGreaterThan(19);

    const chunks: Uint8Array[] = [];
    const writer = new OtlmWriter(
      { append: (b) => chunks.push(Buffer.from(b)) },
      buildLogHeader({
        sessionId: "size-test",
        sim: "iracing",
        startedAt: 0,
        fieldSlots: fieldSlotsFor(first),
      }),
    );
    const sampler = new TelemetrySampler(writer, fieldSlotsFor(first));
    const passes = 3;
    const shift = lengthS + 1 / 57;
    let frames = 0;
    for (let pass = 0; pass < passes; pass++) {
      for (const state of slice) {
        sampler.accept({ ...state, tickTimeS: (state.tickTimeS ?? 0) + pass * shift });
        frames++;
      }
    }
    writer.close();
    const bytes = Buffer.concat(chunks);
    const seconds = passes * lengthS;
    const mbPerHour = ((bytes.length / seconds) * 3600) / 1e6;
    const file = readOtlm(bytes);
    const player = file.groups["player"]?.samples ?? 0;
    const field = file.groups["field"]?.samples ?? 0;
    console.log(
      `tier 2 size: ${frames} frames over ${seconds.toFixed(1)} s -> ${bytes.length} bytes ` +
        `(${player} player samples at ${(player / seconds).toFixed(1)} Hz, ${field} field samples ` +
        `at ${(field / seconds).toFixed(2)} Hz, ${fieldSlotsFor(first)} car slots) = ` +
        `${mbPerHour.toFixed(2)} MB per hour`,
    );
    expect(file.complete).toBe(true);
    // The numbers survive, not just the byte count: the mean speed and pedal position match.
    const mean = (values: ArrayLike<number>): number =>
      Array.from(values).reduce((a, b) => a + b, 0) / values.length;
    const speeds = slice.map((s) => s.player.speedMps ?? NaN);
    const throttles = slice.map((s) => s.player.inputs.throttle ?? NaN);
    expect(mean(file.groups["player"]?.channels["speed"] ?? [])).toBeCloseTo(mean(speeds), 0);
    expect(mean(file.groups["player"]?.channels["throttle"] ?? [])).toBeCloseTo(mean(throttles), 1);
    expect(mean(speeds)).toBeGreaterThan(10);
    expect(player / seconds).toBeGreaterThan(50);
    expect(player / seconds).toBeLessThanOrEqual(60);
    expect(field / seconds).toBeLessThanOrEqual(4.1);
    expect(mbPerHour).toBeLessThan(30);
  });
});
