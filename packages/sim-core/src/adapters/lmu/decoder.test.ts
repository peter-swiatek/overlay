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
  teamFromVehicleName,
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
  WHEEL,
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
const damaged = await load("lmu-damage-impacts-10s-5hz.ovfx");

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

  it("reads the compound, brake, carcass and inner-layer temperatures", () => {
    const garage = onTrack.rest.find((r) => r.path === "/rest/garage/getPlayerGarageData");
    const setting = (key: string) =>
      (garage?.body as Record<string, { stringValue?: string }> | undefined)?.[key]?.stringValue;
    expect(setting("VM_FRONT_TIRE_COMPOUND")).toBe("Soft");
    for (const { result } of onTrack.frames) {
      const t = result.state.player.tyres;
      expect(t?.frontCompound).toBe(setting("VM_FRONT_TIRE_COMPOUND"));
      expect(t?.rearCompound).toBe(setting("VM_REAR_TIRE_COMPOUND"));
      // One set on all four wheels, as the garage's per-wheel settings say.
      expect([t?.fl, t?.fr, t?.rl, t?.rr].map((c) => c?.compound)).toEqual(
        ["FL", "FR", "RL", "RR"].map((w) => setting(`WM_COMPOUND-W_${w}`)),
      );
      for (const corner of [t?.fl, t?.fr, t?.rl, t?.rr]) {
        // An early lap: the brakes are still warming up but above the 30 C air.
        expect(corner?.brakeTempC).toBeGreaterThan(40);
        expect(corner?.brakeTempC).toBeLessThan(1000);
        expect(corner?.carcassTempC).toBeGreaterThan(20);
        expect(corner?.carcassTempC).toBeLessThan(120);
        const layer = corner?.innerLayerTemps;
        for (const v of [layer?.inner, layer?.middle, layer?.outer]) {
          expect(v).toBeGreaterThan(20);
          expect(v).toBeLessThan(120);
          expect(Math.abs((v ?? 0) - (corner?.temps.middle ?? 0))).toBeLessThan(40);
        }
      }
      // Fronts carry most of the braking.
      expect(t?.fl.brakeTempC ?? 0).toBeGreaterThan(t?.rl.brakeTempC ?? 0);
    }
  });

  it("orders the inner-layer temperatures like the surface ones", () => {
    // The car turns both ways in the slice, so compare the sign of the edge difference over it.
    let agree = 0;
    let total = 0;
    for (const { result } of onTrack.frames) {
      const t = result.state.player.tyres;
      for (const c of [t?.fl, t?.fr, t?.rl, t?.rr]) {
        const surface = (c?.temps.inner ?? 0) - (c?.temps.outer ?? 0);
        const layer = (c?.innerLayerTemps?.inner ?? 0) - (c?.innerLayerTemps?.outer ?? 0);
        if (Math.abs(surface) < 2) continue;
        total++;
        if (Math.sign(surface) === Math.sign(layer)) agree++;
      }
    }
    expect(total).toBeGreaterThan(20);
    expect(agree / total).toBeGreaterThan(0.8);
  });

  it("names the sim and gives the player's world position", () => {
    const positions = onTrack.frames.map(({ result }) => result.state.player.worldPos);
    for (const { result } of onTrack.frames) {
      expect(result.state.sim).toBe("lmu");
      expect(result.state.session.trackConfig).toBeNull();
    }
    expect(positions.every((p) => p !== null)).toBe(true);
    // The car is moving at 10 to 110 m/s, so the position has to follow the speed: over a
    // second it covers about as far as the speed says.
    const first = onTrack.frames[0]!.result.state;
    const later = onTrack.frames.find(
      ({ result }) => (result.state.tickTimeS ?? 0) >= (first.tickTimeS ?? 0) + 1,
    )!.result.state;
    const moved = Math.hypot(
      (later.player.worldPos?.x ?? 0) - (first.player.worldPos?.x ?? 0),
      (later.player.worldPos?.z ?? 0) - (first.player.worldPos?.z ?? 0),
    );
    const expected = ((first.player.speedMps ?? 0) + (later.player.speedMps ?? 0)) / 2;
    const dt = (later.tickTimeS ?? 0) - (first.tickTimeS ?? 0);
    expect(moved / dt).toBeGreaterThan(expected * 0.8);
    expect(moved / dt).toBeLessThan(expected * 1.2);
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

  it("sets the class colour from the class name", () => {
    const { state } = onTrack.frames.at(-1)!.result;
    for (const car of state.cars) {
      if (car.className === "Hyper") expect(car.classColour).toBe("#E4002B");
      else if (car.className === "LMP2") expect(car.classColour).toBe("#0057B8");
      else expect(car.classColour).toBeNull();
    }
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

describe("field data for overlays", () => {
  const raw = onTrack.frames[0]!.raw;
  const rowOf = (i: number) => VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE;
  const playerTelemetryRow = (buffer: Buffer) =>
    TELEMETRY_BASE +
    TELEMETRY.rowsOffset +
    buffer[TELEMETRY_BASE + TELEMETRY.playerRowIndex]! * TELEMETRY.rowStride;

  it("reads a world position and a fuel fraction for every vehicle in the slice", () => {
    for (const { result } of onTrack.frames) {
      const { cars } = result.state;
      expect(cars.length).toBe(37);
      for (const car of cars) {
        expect(car.worldPos).not.toBeNull();
        expect(Number.isFinite((car.worldPos?.x ?? NaN) + (car.worldPos?.z ?? NaN))).toBe(true);
        expect(car.fuelFraction).toBeGreaterThanOrEqual(0);
        expect(car.fuelFraction).toBeLessThanOrEqual(1);
      }
      expect(result.state.player.worldPos).toEqual(cars.find((c) => c.isPlayer)?.worldPos);
    }
  });

  it("fills the player's brake bias, the time of day and a team for every car in the slice", () => {
    const { state } = new LmuDecoder().decode(raw);
    expect(state.player.brakeBias).toBeGreaterThan(0.3);
    expect(state.player.brakeBias).toBeLessThan(0.7);
    expect(state.session.timeOfDayS).toBeGreaterThan(0);
    expect(state.session.timeOfDayS).toBeLessThan(86_400);
    expect(state.cars.every((c) => c.teamName !== null && c.teamName.length > 0)).toBe(true);
    expect(state.cars.every((c) => !(c.teamName ?? "").includes("#"))).toBe(true);
  });

  it("decodes synthetic values at the documented offsets", () => {
    const edited = Buffer.from(raw);
    const row = rowOf(2);
    edited.writeUInt8(204, row + VEHICLE.fuelFraction); // 204 / 255 = 0.8
    edited.writeDoubleLE(-142.5, row + VEHICLE.worldPos);
    edited.writeDoubleLE(7.25, row + VEHICLE.worldPos + 8);
    edited.writeDoubleLE(1155.5, row + VEHICLE.worldPos + 16);
    edited.writeFloatLE(51_000, SCORING_BASE + SESSION.timeOfDay);
    edited.writeDoubleLE(0.45, playerTelemetryRow(edited) + TELEM.rearBrakeBias);
    const { state } = new LmuDecoder().decode(edited);
    const car = state.cars[2]!;
    expect(car.fuelFraction).toBeCloseTo(0.8, 6);
    expect(car.worldPos).toEqual({ x: -142.5, y: 7.25, z: 1155.5 });
    expect(state.session.timeOfDayS).toBe(51_000);
    expect(state.player.brakeBias).toBeCloseTo(0.55, 6);
  });

  it("decodes synthetic tyre values at the documented offsets", () => {
    const edited = Buffer.from(raw);
    const row = playerTelemetryRow(edited);
    const wheel = (w: number) => row + TELEM.tyresOffset + w * TELEM.tyreStride;
    edited.fill(0, row + TELEM.frontCompound.offset, row + TELEM.rearCompound.offset + 18);
    edited.write("Wet", row + TELEM.frontCompound.offset, "latin1");
    edited.writeDoubleLE(773.15, wheel(1) + WHEEL.brakeTempK);
    edited.writeDoubleLE(353.15, wheel(1) + WHEEL.carcassTempK);
    // Front right: the left column is the inner edge.
    edited.writeDoubleLE(363.15, wheel(1) + WHEEL.innerLayerTempK);
    edited.writeDoubleLE(358.15, wheel(1) + WHEEL.innerLayerTempK + 8);
    edited.writeDoubleLE(353.15, wheel(1) + WHEEL.innerLayerTempK + 16);
    // Front left: the left column is the outer edge.
    edited.writeDoubleLE(343.15, wheel(0) + WHEEL.innerLayerTempK);
    // A brake value outside any physical window is dropped, not the frame.
    edited.writeDoubleLE(0, wheel(2) + WHEEL.brakeTempK);
    const { state, error } = new LmuDecoder().decode(edited);
    expect(error).toBeNull();
    const t = state.player.tyres;
    expect(t?.frontCompound).toBe("Wet");
    expect(t?.rearCompound).toBeNull();
    expect(t?.fr.brakeTempC).toBeCloseTo(500, 6);
    expect(t?.fr.carcassTempC).toBeCloseTo(80, 6);
    expect(t?.fr.innerLayerTemps?.inner).toBeCloseTo(90, 6);
    expect(t?.fr.innerLayerTemps?.middle).toBeCloseTo(85, 6);
    expect(t?.fr.innerLayerTemps?.outer).toBeCloseTo(80, 6);
    expect(t?.fl.innerLayerTemps?.outer).toBeCloseTo(70, 6);
    expect(t?.rl.brakeTempC).toBeNull();
    // Each wheel takes its own axle's name, which the rear no longer has.
    expect(t?.fl.compound).toBe("Wet");
    expect(t?.rr.compound).toBeNull();
  });

  it("names each wheel's compound from its list position, else from its kind", () => {
    const edited = Buffer.from(raw);
    const row = playerTelemetryRow(edited);
    const wheel = (w: number) => row + TELEM.tyresOffset + w * TELEM.tyreStride;
    const name = (o: number, text: string) => {
      edited.fill(0, row + o, row + o + 18);
      edited.write(text, row + o, "latin1");
    };
    // Soft fronts (list position 0), Medium rears (1).
    name(TELEM.frontCompound.offset, "Soft");
    name(TELEM.rearCompound.offset, "Medium");
    edited.writeUInt8(0, row + TELEM.frontCompoundIndex);
    edited.writeUInt8(1, row + TELEM.rearCompoundIndex);
    const fit = (w: number, index: number, kind: number) => {
      edited.writeUInt8(index, wheel(w) + WHEEL.compoundIndex);
      edited.writeUInt8(kind, wheel(w) + WHEEL.compoundKind);
    };
    fit(0, 0, 0); // the front's own compound
    fit(1, 1, 1); // the rear compound on a front wheel
    fit(2, 2, 2); // neither axle's: named by its kind
    fit(3, 5, 9); // an unknown kind
    const t = new LmuDecoder().decode(edited).state.player.tyres;
    expect([t?.fl, t?.fr, t?.rl, t?.rr].map((c) => c?.compound)).toEqual([
      "Soft",
      "Medium",
      "Hard",
      null,
    ]);
  });

  it("wraps a time of day past 24 h and ignores a rear bias outside 0..1", () => {
    const edited = Buffer.from(raw);
    edited.writeFloatLE(86_400 + 120, SCORING_BASE + SESSION.timeOfDay);
    edited.writeDoubleLE(0, playerTelemetryRow(edited) + TELEM.rearBrakeBias);
    const { state } = new LmuDecoder().decode(edited);
    expect(state.session.timeOfDayS).toBe(120);
    expect(state.player.brakeBias).toBeNull();
  });

  it("leaves what is not proven null", () => {
    const { state } = new LmuDecoder().decode(raw);
    expect(state.session.pitSpeedLimitMps).toBeNull();
    expect(state.session.incidentLimit).toBeNull();
    expect(state.player.pitStallLapDistPct).toBeNull();
    expect(state.conditions).toMatchObject({
      precipitation: null,
      humidity: null,
      fogLevel: null,
      windSpeedMps: null,
      windDirRad: null,
    });
  });

  it("fills the player's lap timing, redline, surface and per-car flags from the slice", () => {
    const { state } = new LmuDecoder().decode(raw);
    const lap = state.player.lap;
    expect(lap).not.toBeNull();
    expect(lap?.delta).toBeNull();
    expect(lap?.currentLapS).toBeGreaterThanOrEqual(0);
    for (const t of [lap?.lastLapS, lap?.bestLapS]) expect(t == null || t > 0).toBe(true);
    expect(state.player.redlineRpm).toBeGreaterThan(5000);
    expect(state.player.trackSurface).toBe("onTrack");
    expect(state.player.isOnTrack).toBe(true);
    expect(state.player.absActive).toBeNull();
    expect(state.player.pitLimiter).toBe(false);
    expect(state.cars.every((c) => c.flags !== null && c.trackSurface === null)).toBe(true);
  });

  it("decodes synthetic lap times, blue flags and the stall surface", () => {
    const edited = Buffer.from(raw);
    const player = new LmuDecoder().decode(raw).state.cars.findIndex((c) => c.isPlayer);
    const row = rowOf(player);
    edited.writeDoubleLE(31.5, row + VEHICLE.timeIntoLap);
    edited.writeDoubleLE(212.25, row + VEHICLE.lastLapTime);
    edited.writeDoubleLE(-1, row + VEHICLE.bestLapTime);
    edited.writeUInt8(6, rowOf(3) + VEHICLE.flag);
    edited.writeUInt8(1, rowOf(4) + VEHICLE.underYellow);
    const { state } = new LmuDecoder().decode(edited);
    expect(state.player.lap).toEqual({
      currentLapS: 31.5,
      lastLapS: 212.25,
      bestLapS: null,
      delta: null,
    });
    expect(state.cars[3]!.flags?.blue).toBe(true);
    expect(state.cars[4]!.flags?.yellow).toBe(true);
    expect(state.cars[5]!.flags?.blue).toBe(false);

    edited.writeUInt8(0, SCORING_BASE + SESSION.inRealtime);
    expect(new LmuDecoder().decode(edited).state.player).toMatchObject({
      trackSurface: "notInWorld",
      isOnTrack: false,
    });

    const away = Buffer.from(raw);
    away.writeUInt8(0, TELEMETRY_BASE + TELEMETRY.playerInCar);
    expect(new LmuDecoder().decode(away).state.player.lap).toBeNull();
  });

  it("learns the sector starts from the player's sector changes", () => {
    const decoder = new LmuDecoder();
    const player = decoder.decode(raw).state.cars.findIndex((c) => c.isPlayer);
    const row = rowOf(player);
    const length = raw.readDoubleLE(SCORING_BASE + SESSION.lapDistance);
    const frame = (rawSector: number, pct: number) => {
      const b = Buffer.from(raw);
      b.writeInt8(rawSector, row + VEHICLE.sector);
      b.writeDoubleLE(pct * length, row + VEHICLE.lapDistance);
      return decoder.decode(b).state.session.sectorStartPcts;
    };
    expect(frame(1, 0.25)).toBeNull();
    expect(frame(2, 0.252)).toBeNull();
    expect(frame(2, 0.6)).toBeNull();
    const starts = frame(0, 0.602)!;
    expect(starts[0]).toBe(0);
    expect(starts[1]!).toBeCloseTo(0.251, 6);
    expect(starts[2]!).toBeCloseTo(0.601, 6);
    expect(frame(0, 0.7)).toEqual(starts);
  });

  it("uses the REST session name as the session type name", () => {
    const decoder = new LmuDecoder();
    decoder.observeRest({
      path: "/rest/watch/sessionInfo",
      status: 200,
      body: { session: "PRACTICE1", maxTime: 3600 },
    });
    expect(decoder.decode(raw).state.session.typeName).toBe("PRACTICE1");
    expect(new LmuDecoder().decode(raw).state.session.typeName).toBeNull();
  });

  it("separates the team from a vehicle name of the observed shape only", () => {
    expect(teamFromVehicleName("Example Racing Team 2026 #83:LM")).toBe("Example Racing Team");
    expect(teamFromVehicleName("Zofia Świątkowska Motorsport 2026 #5:A")).toBe(
      "Zofia Świątkowska Motorsport",
    );
    expect(teamFromVehicleName("Some Car")).toBeNull();
    expect(teamFromVehicleName("2026 #1:X")).toBeNull();
    expect(teamFromVehicleName("")).toBeNull();
  });

  it("prefers the REST team name over the one parsed from the vehicle name", () => {
    const decoder = new LmuDecoder();
    const parsed = decoder.decode(raw).state.cars[0]?.teamName;
    expect(parsed).not.toBeNull();
    decoder.observeRest({
      path: "/rest/watch/standings",
      status: 200,
      body: [{ slotID: raw.readInt32LE(rowOf(0)), fullTeamName: "Max Example Racing" }],
    });
    expect(decoder.decode(raw).state.cars[0]?.teamName).toBe("Max Example Racing");
  });

  it("reads the player's heading from the orientation matrix (nose = minus the third column)", () => {
    const playerRow = rowOf(onTrack.frames[0]!.result.state.cars.findIndex((c) => c.isPlayer));
    const withNose = (fx: number, fz: number) => {
      const edited = Buffer.from(raw);
      // Rows of the matrix; only the third column matters: column 3 = -(nose).
      const o = playerRow + VEHICLE.orientation;
      [1, 0, -fx, 0, 1, 0, 0, 0, -fz].forEach((v, i) => edited.writeDoubleLE(v, o + i * 8));
      return new LmuDecoder().decode(edited).state.player.yawRad;
    };
    const dir = (yaw: number | null) => [-Math.sin(yaw as number), -Math.cos(yaw as number)];
    // Nose towards -z (yaw 0), towards -x (yaw 90 degrees), towards +z, and a slanted one.
    expect(withNose(0, -1)).toBeCloseTo(0, 9);
    expect(withNose(-1, 0)).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(withNose(0, 1) as number)).toBeCloseTo(Math.PI, 9);
    const k = Math.SQRT1_2;
    const [dx, dz] = dir(withNose(k, k));
    expect(dx).toBeCloseTo(k, 9);
    expect(dz).toBeCloseTo(k, 9);
    // A matrix with the nose pointing straight up gives no heading.
    expect(withNose(0, 0)).toBeNull();
  });

  it("keeps a car in the pits in the world and tells it from one that is not there", () => {
    const edited = Buffer.from(raw);
    edited.writeUInt8(1, rowOf(1) + VEHICLE.pitting);
    edited.writeInt8(1, rowOf(1) + VEHICLE.inControl);
    edited.writeInt8(-1, rowOf(2) + VEHICLE.inControl);
    const { cars } = new LmuDecoder().decode(edited).state;
    expect(cars[1]).toMatchObject({ onPitRoad: true, isOnTrack: true, connected: true });
    expect(cars[2]).toMatchObject({ isOnTrack: null, connected: false });
  });

  it("falls back to the REST team name when the vehicle name has no recognisable shape", () => {
    const edited = Buffer.from(raw);
    const at = rowOf(0) + VEHICLE.vehicleName.offset;
    edited.fill(0, at, at + VEHICLE.vehicleName.length);
    edited.write("Plain Name", at, "latin1");
    const decoder = new LmuDecoder();
    expect(decoder.decode(edited).state.cars[0]?.teamName).toBeNull();
    decoder.observeRest({
      path: "/rest/watch/standings",
      status: 200,
      body: [{ slotID: edited.readInt32LE(rowOf(0)), fullTeamName: "Max Example Racing" }],
    });
    expect(decoder.decode(edited).state.cars[0]?.teamName).toBe("Max Example Racing");
  });
});

describe("LmuDecoder on the damage slice", () => {
  const states = damaged.frames.map((f) => f.result.state);
  const driving = states.filter((s) => s.player.tyres !== null);

  it("decodes every frame", () => {
    expect(damaged.frames.length).toBeGreaterThan(40);
    for (const { result } of damaged.frames) {
      expect(result.error).toBeNull();
      expect(isSimState(result.state)).toBe(true);
    }
    expect(driving.length).toBeGreaterThan(30);
  });

  it("reads the dents as they appear: nose, then the left rear quarter, then the tail", () => {
    const seen: string[] = [];
    for (const s of driving) {
      const dents = s.player.damage?.dents.join(",") ?? "none";
      if (seen.at(-1) !== dents) seen.push(dents);
    }
    expect(seen).toEqual([
      "0,0,0,0,0,0,0,0",
      "2,0,0,0,0,0,0,0",
      "2,0,0,2,0,0,0,0",
      "2,0,0,2,2,0,0,0",
    ]);
  });

  it("flags the rear-left tyre, whose pressure and tread read zero", () => {
    for (const s of driving) {
      expect(s.player.damage?.tyreFlat).toEqual({ fl: false, fr: false, rl: true, rr: false });
      expect(s.player.tyres?.rl.pressureKpa).toBe(0);
      expect(s.player.tyres?.rl.wear).toBe(1);
      expect(s.player.tyres?.fl.pressureKpa).toBeGreaterThan(100);
    }
  });

  it("keeps the last impact time on the session clock", () => {
    const times = new Set<number>();
    for (const s of driving) {
      const at = s.player.damage?.lastImpactS ?? null;
      expect(at).not.toBeNull();
      expect(at!).toBeLessThanOrEqual((s.tickTimeS ?? 0) + 0.2);
      times.add(at!);
    }
    expect([...times][0]).toBeCloseTo(343.5, 1);
    expect([...times].at(-1)).toBeCloseTo(349.72, 2);
    expect(times.size).toBeGreaterThan(5);
  });

  it("clears everything when the car is reset to the garage", () => {
    const last = states.at(-1)!;
    expect(last.player.tyres).toBeNull();
    expect(last.player.damage).toEqual({
      dents: [0, 0, 0, 0, 0, 0, 0, 0],
      tyreFlat: { fl: false, fr: false, rl: false, rr: false },
      lastImpactS: null,
    });
  });

  it("has no damage on the clean on-track slice", () => {
    for (const { result } of onTrack.frames) {
      expect(result.state.player.damage?.dents).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(Object.values(result.state.player.damage?.tyreFlat ?? {})).not.toContain(true);
    }
  });
});
