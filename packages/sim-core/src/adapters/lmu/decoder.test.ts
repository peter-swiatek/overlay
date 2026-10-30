import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RecordKind } from "../../fixtures/format";
import { FixtureReader } from "../../fixtures/reader";
import { isSimState } from "../../model";
import {
  LmuDecoder,
  numberFromVehicleName,
  phaseOf,
  sessionTypeOf,
  type LmuDecodeResult,
} from "./decoder";
import {
  HEADER,
  LMU_MAPPING_BYTES,
  SCORING_BASE,
  SESSION,
  VEHICLE,
  VEHICLE_ROWS_OFFSET,
  VEHICLE_STRIDE,
  TELEM,
  TELEMETRY,
  TELEMETRY_BASE,
} from "./layout";

const dir = fileURLToPath(new URL("../../../../../fixtures/", import.meta.url));

interface RestBody {
  path: string;
  status: number;
  body: unknown;
}

interface Loaded {
  rest: RestBody[];
  /** Decoded frames plus the raw buffers, in order. */
  frames: { raw: Buffer; result: LmuDecodeResult }[];
  /** REST responses seen before the first buffer, for field-by-field comparison. */
  leadingRest: RestBody[];
}

async function load(name: string): Promise<Loaded> {
  const reader = new FixtureReader(createReadStream(`${dir}${name}`));
  const decoder = new LmuDecoder();
  const loaded: Loaded = { rest: [], frames: [], leadingRest: [] };
  for await (const record of reader.records()) {
    if (record.kind === RecordKind.RestResponse) {
      const rest = JSON.parse(record.payload.toString("utf8")) as RestBody;
      loaded.rest.push(rest);
      if (loaded.frames.length === 0) loaded.leadingRest.push(rest);
      decoder.observeRest(rest);
    } else if (record.kind === RecordKind.LmuBuffer) {
      loaded.frames.push({ raw: record.payload, result: decoder.decode(record.payload) });
    }
  }
  return loaded;
}

const onTrack = await load("lmu-hypercar-onpace-10s-5hz.ovfx");
const burst = await load("lmu-burst-first-5s.ovfx");

describe("LmuDecoder on the on-track slice", () => {
  it("decodes every frame into a valid SimState", () => {
    expect(onTrack.frames.length).toBeGreaterThan(40);
    for (const { result } of onTrack.frames) {
      expect(result.error).toBeNull();
      expect(result.state.connected).toBe(true);
      expect(result.state.source).toBe("lmu");
      expect(isSimState(result.state)).toBe(true);
      expect(result.warnings).toEqual([]);
    }
  });

  it("finds 37 cars, one of them the player", () => {
    const { state } = onTrack.frames[0]!.result;
    expect(state.cars).toHaveLength(37);
    expect(state.cars.filter((c) => c.isPlayer)).toHaveLength(1);
    expect(state.playerCarIdx).toBe(0);
    expect(state.focusCarIdx).toBe(0);
    expect(new Set(state.cars.map((c) => c.carIdx)).size).toBe(37);
    expect(state.cars.map((c) => c.className)).toContain("LMP2");
  });

  it("gives a plausible player", () => {
    for (const { result } of onTrack.frames) {
      const p = result.state.player;
      expect(p.speedMps).toBeGreaterThan(10);
      expect(p.speedMps).toBeLessThan(110);
      expect(p.rpm).toBeGreaterThan(3000);
      expect(p.rpm).toBeLessThan(8600);
      expect(p.gear).toBeGreaterThanOrEqual(1);
      expect(p.gear).toBeLessThanOrEqual(7);
      expect(p.fuelCapacityL).toBe(110);
      expect(p.fuelL).toBeGreaterThan(0);
      expect(p.fuelL).toBeLessThanOrEqual(p.fuelCapacityL ?? 0);
      expect(p.energyFraction).toBeGreaterThan(0.9);
      expect(p.energyFraction).toBeLessThanOrEqual(1);
      expect(p.pitLimiter).toBe(false);
      const tyres = p.tyres;
      expect(tyres).not.toBeNull();
      for (const corner of [tyres?.fl, tyres?.fr, tyres?.rl, tyres?.rr]) {
        expect(corner?.temps.inner).toBeGreaterThan(30);
        expect(corner?.temps.inner).toBeLessThan(120);
        expect(corner?.pressureKpa).toBeGreaterThan(100);
        expect(corner?.wear).toBeGreaterThanOrEqual(0);
        expect(corner?.wear).toBeLessThan(0.05);
      }
    }
  });

  it("keeps lap percentages in [0, 1]", () => {
    for (const { result } of onTrack.frames) {
      for (const car of result.state.cars) {
        expect(car.lapDistPct).toBeGreaterThanOrEqual(0);
        expect(car.lapDistPct).toBeLessThanOrEqual(1);
      }
    }
  });

  it("reads the session block", () => {
    const { state } = onTrack.frames[0]!.result;
    expect(state.session.trackName).toBe("Circuit de la Sarthe");
    expect(state.session.trackLengthM).toBeCloseTo(13623.9677734375, 6);
    expect(state.session.type).toBe("practice");
    expect(state.session.phase).toBe("racing");
    expect(state.session.timing).toBe("time");
    expect(state.session.lapsTotal).toBeNull();
    expect(state.session.timeTotalS).toBe(3600);
    expect(state.session.timeRemainingS).toBeGreaterThan(3400);
    expect(state.conditions.wetness).toBe(0);
    expect(state.conditions.trackTempC).toBeGreaterThan(40);
    expect(state.flags?.green).toBe(true);
  });

  it("agrees with the standings recorded just before the first frame", () => {
    const standings = onTrack.leadingRest.find((r) => r.path === "/rest/watch/standings");
    const rows = standings?.body as Record<string, unknown>[];
    const first = onTrack.frames[0]!.result.state;
    expect(rows).toHaveLength(37);
    let samePlace = 0;
    for (const row of rows) {
      const car = first.cars.find((c) => c.carIdx === row["slotID"]);
      expect(car).toBeDefined();
      expect(car?.lapsCompleted).toBe(row["lapsCompleted"]);
      expect(car?.className).toBe(row["carClass"]);
      expect(car?.isPlayer).toBe(row["player"]);
      expect(car?.carNumber).toBe(row["carNumber"]);
      // Nobody has finished a lap yet: both sides say "no lap time".
      expect(car?.lastLapS).toBeNull();
      expect(row["lastLapTime"]).toBe(0);
      expect(car?.bestLapS).toBeNull();
      expect(row["bestLapTime"]).toBe(-1);
      // Time into the lap is polled up to a second apart.
      expect(Math.abs((car?.estTimeS ?? 0) - (row["timeIntoLap"] as number))).toBeLessThan(2);
      expect(car?.onPitRoad).toBe(row["pitting"]);
      const meters = (car?.lapDistPct ?? 0) * (first.session.trackLengthM ?? 0);
      // REST is polled a moment before the buffer: cars move up to ~100 m/s * 1 s.
      expect(Math.abs(meters - (row["lapDistance"] as number))).toBeLessThan(150);
      if (car?.position === row["position"]) samePlace++;
    }
    expect(samePlace).toBeGreaterThanOrEqual(34);
    const player = rows.find((r) => r["player"] === true);
    const p = first.player;
    expect((p.fuelL ?? 0) / (p.fuelCapacityL ?? 1)).toBeCloseTo(
      player?.["fuelFraction"] as number,
      2,
    );
    expect(p.energyFraction).toBeCloseTo(player?.["veFraction"] as number, 2);
  });

  it("joins REST class and number by slot", () => {
    const { state } = onTrack.frames.at(-1)!.result;
    const player = state.cars.find((c) => c.isPlayer);
    expect(player?.carNumber).toBe("83");
    expect(player?.classId).toBe("Hyper");
    expect(player?.classPosition).toBeGreaterThanOrEqual(1);
  });
});

describe("LmuDecoder on the burst slice", () => {
  it("decodes every frame", () => {
    expect(burst.frames.length).toBeGreaterThan(200);
    for (const { result } of burst.frames) {
      expect(result.error).toBeNull();
      expect(isSimState(result.state)).toBe(true);
    }
  });

  it("never moves time backwards and advances scoring at about 5 Hz", () => {
    const view = (raw: Buffer): DataView =>
      new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let lastEt = -Infinity;
    let lastElapsed = -Infinity;
    const distinctEt = new Set<number>();
    for (const { raw } of burst.frames) {
      const v = view(raw);
      const et = v.getFloat64(SCORING_BASE + SESSION.currentEventTime, true);
      expect(et).toBeGreaterThanOrEqual(lastEt);
      lastEt = et;
      distinctEt.add(et);
      const row =
        TELEMETRY_BASE +
        TELEMETRY.rowsOffset +
        v.getUint8(TELEMETRY_BASE + TELEMETRY.playerRowIndex) * TELEMETRY.rowStride;
      const elapsed = v.getFloat64(row + TELEM.sessionTime, true);
      expect(elapsed).toBeGreaterThanOrEqual(lastElapsed);
      lastElapsed = elapsed;
    }
    // About 5 s of burst: roughly 25 scoring ticks shared by 244 frames, so ET repeats.
    expect(distinctEt.size).toBeGreaterThan(10);
    expect(distinctEt.size).toBeLessThan(burst.frames.length / 3);
  });

  it("reports tickTimeS from the scoring clock", () => {
    const times = burst.frames.map((f) => f.result.state.tickTimeS ?? NaN);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
  });
});

describe("LmuDecoder fails closed", () => {
  const good = onTrack.frames[0]!.raw;
  const decoder = new LmuDecoder();

  function expectRefused(buffer: Uint8Array, pattern: RegExp): void {
    const result = decoder.decode(buffer);
    expect(result.error).toMatch(pattern);
    expect(result.state.connected).toBe(false);
    expect(isSimState(result.state)).toBe(true);
  }

  it("refuses a short buffer", () => {
    expectRefused(good.subarray(0, 100_000), /bytes/);
  });

  it("refuses an unpopulated mapping", () => {
    expectRefused(new Uint8Array(LMU_MAPPING_BYTES), /gameVersion/);
  });

  it("refuses a shifted layout", () => {
    const shifted = new Uint8Array(good.length);
    shifted.set(good.subarray(0, good.length - 8), 8);
    expect(decoder.decode(shifted).error).toMatch(/^(appBuild|vehicle count) /);
  });

  it("refuses an implausible player value", () => {
    const bad = Buffer.from(good);
    const row =
      TELEMETRY_BASE +
      TELEMETRY.rowsOffset +
      bad[TELEMETRY_BASE + TELEMETRY.playerRowIndex]! * TELEMETRY.rowStride;
    bad.writeDoubleLE(1e9, row + TELEM.engineRpm);
    expectRefused(bad, /rpm/);
  });

  it("warns, but still decodes, on an unvalidated game build", () => {
    const other = Buffer.from(good);
    other.writeInt32LE(15000, HEADER.appBuild);
    const result = decoder.decode(other);
    expect(result.error).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/15000/);
  });
});

describe("mappings", () => {
  it("maps the observed session code and falls back to the REST name", () => {
    expect(sessionTypeOf(1, null)).toBe("practice");
    expect(sessionTypeOf(77, "RACE1")).toBe("race");
    expect(sessionTypeOf(77, "QUALIFY1")).toBe("qualifying");
    expect(sessionTypeOf(77, null)).toBeNull();
  });

  it("maps only the observed game phases", () => {
    expect(phaseOf(0)).toBe("garage");
    expect(phaseOf(5)).toBe("racing");
    expect(phaseOf(8)).toBeNull();
  });

  it("reads the car number from the vehicle name on the slice, without REST", () => {
    expect(numberFromVehicleName("Some Team 2026 #83:LM")).toBe("83");
    expect(numberFromVehicleName("no number")).toBeNull();
    const bare = new LmuDecoder().decode(onTrack.frames[0]!.raw);
    const player = bare.state.cars.find((c) => c.isPlayer);
    expect(player?.carName).toMatch(/ 2026 #83:LM/);
    expect(player?.carNumber).toBe("83");
    expect(bare.state.cars.every((c) => c.carName?.includes(" 2026 #"))).toBe(true);
  });
});

describe("pit stall and leader laps", () => {
  const raw = onTrack.frames[0]!.raw;

  it("does not call a parked garage car in its stall unless it is on pit road and running", () => {
    const state = new LmuDecoder().decode(raw).state;
    const garaged = state.cars.filter((c) => c.onPitRoad);
    expect(garaged.length).toBeGreaterThan(10);
    // Garage-stall flag is set for these, the session runs and they are on pit road.
    expect(garaged.some((c) => c.inPitStall === true)).toBe(true);
    const trackCars = state.cars.filter((c) => !c.onPitRoad);
    expect(trackCars.every((c) => c.inPitStall === null)).toBe(true);
  });

  it("uses the REST pit state when the flag does not decide", () => {
    const decoder = new LmuDecoder();
    decoder.observeRest({
      path: "/rest/watch/standings",
      status: 200,
      body: [{ slotID: 0, pitState: "NONE" }],
    });
    const player = decoder.decode(raw).state.cars.find((c) => c.carIdx === 0);
    expect(player?.inPitStall).toBe(false);
  });

  it("counts remaining laps from the leader", () => {
    const edited = Buffer.from(raw);
    edited.writeInt32LE(10, SCORING_BASE + SESSION.maximumLaps);
    for (let i = 0; i < 37; i++) {
      const row = VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE;
      if (edited.readUInt8(row + VEHICLE.position) === 1)
        edited.writeInt16LE(4, row + VEHICLE.lapsCompleted);
    }
    const { state } = new LmuDecoder().decode(edited);
    expect(state.session.timing).toBe("laps-or-time");
    expect(state.session.lapsRemaining).toBe(6);
  });
});

describe("frame consistency", () => {
  const raw = onTrack.frames[0]!.raw;

  it("rejects a frame whose scoring and telemetry counts differ", () => {
    const edited = Buffer.from(raw);
    edited.writeUInt8(36, TELEMETRY_BASE + TELEMETRY.carsWithTelemetry);
    const result = new LmuDecoder().decode(edited);
    expect(result.error).toMatch(/37 vehicles, telemetry 36/);
    expect(result.state.connected).toBe(false);
  });

  it("drops cached REST data when the session or the clock changes", () => {
    const decoder = new LmuDecoder();
    decoder.observeRest({
      path: "/rest/watch/standings",
      status: 200,
      body: [{ slotID: 0, carNumber: "999", carClass: "Hyper" }],
    });
    expect(decoder.decode(raw).state.cars.find((c) => c.carIdx === 0)?.carNumber).toBe("999");
    const later = Buffer.from(raw);
    later.writeInt32LE(6, SCORING_BASE + SESSION.sessionCode);
    expect(decoder.decode(later).state.cars.find((c) => c.carIdx === 0)?.carNumber).toBe("83");
  });
});
