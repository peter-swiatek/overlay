import { createReadStream } from "node:fs";
import { describe, expect, it } from "vitest";
import { IracingAdapter } from "../adapters/iracing/adapter";
import { decodeSessionYaml } from "../adapters/iracing/decoder";
import { parseSessionYaml, type IracingSessionInfo } from "../adapters/iracing/session-yaml";
import { LmuDecoder } from "../adapters/lmu/decoder";
import { RecordKind } from "../fixtures/format";
import { FixtureReader } from "../fixtures/reader";
import type { SimState } from "../model";
import { Deriver } from "../telemetry/derive";
import { TrackOutlineBuilder, MAX_CLOSURE_FRACTION, MAX_LENGTH_ERROR } from "./builder";
import { pointAtPct, signedArea } from "./outline";
import { toSample, type TrackTracker } from "./tracker";
import { trackKeyOf } from "./track-key";
import type { LapResult, TrackOutline } from "./types";

/**
 * Local only: set OVERLAY_IRACING_RECORDING and OVERLAY_LMU_RECORDING to copies of Peter's raw
 * recordings. They hold real drivers, so nothing here prints a name; cars are only carIdx.
 */
const iracingPath = process.env["OVERLAY_IRACING_RECORDING"];
const lmuPath = process.env["OVERLAY_LMU_RECORDING"];

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

/** Every lap the builder judged, plus the Deriver's final outline. */
async function run(states: AsyncGenerator<SimState>): Promise<{
  laps: LapResult[];
  outline: TrackOutline | null;
  tracker: TrackTracker;
  trackLengthM: number | null;
  msPerState: number;
}> {
  const deriver = new Deriver();
  let builder: TrackOutlineBuilder | null = null;
  const laps: LapResult[] = [];
  let trackLengthM: number | null = null;
  let spent = 0;
  let count = 0;
  for await (const state of states) {
    const started = performance.now();
    deriver.next(state);
    spent += performance.now() - started;
    count++;
    const key = trackKeyOf(state);
    if (key === null) continue;
    trackLengthM = state.session.trackLengthM;
    // A second builder that is never short-circuited, to see every lap, not just the first good one.
    builder ??= new TrackOutlineBuilder({ trackKey: key, trackLengthM });
    const player = state.cars.find((c) => c.carIdx === state.playerCarIdx) ?? null;
    const sample = toSample(state, player);
    const result = sample === null ? null : builder.push(sample);
    if (result !== null) laps.push(result);
  }
  return {
    laps,
    outline: deriver.trackOutline,
    tracker: deriver.trackTracker,
    trackLengthM,
    msPerState: spent / Math.max(1, count),
  };
}

function summarise(name: string, laps: LapResult[], outline: TrackOutline): void {
  const good = laps.filter((l): l is Extract<LapResult, { ok: true }> => l.ok);
  const errors = good.map((l) => l.outline.closureErrorM).sort((a, b) => a - b);
  const rejected = new Map<string, number>();
  for (const l of laps) if (!l.ok) rejected.set(l.reason, (rejected.get(l.reason) ?? 0) + 1);
  console.info(
    `${name}: ${laps.length} laps judged, ${good.length} good; closure error before correction ` +
      `min ${errors[0]?.toFixed(1)} m, median ${errors[Math.floor(errors.length / 2)]?.toFixed(1)} m, ` +
      `max ${errors[errors.length - 1]?.toFixed(1)} m; rejected ${JSON.stringify([...rejected])}; ` +
      `kept outline ${outline.source}, ${outline.lengthM.toFixed(0)} m, closure ${outline.closureErrorM.toFixed(1)} m`,
  );
}

function expectGoodOutline(outline: TrackOutline, trackLengthM: number | null): void {
  expect(trackLengthM).not.toBeNull();
  const length = trackLengthM ?? 1;
  expect(outline.closureErrorM).toBeLessThan(MAX_CLOSURE_FRACTION * length);
  expect(Math.abs(outline.lengthM - length)).toBeLessThan(MAX_LENGTH_ERROR * length);
  expect(pointAtPct(outline, 0)).toEqual(pointAtPct(outline, 1));
  // Both Virginia International Raceway and the Circuit de la Sarthe run clockwise.
  expect(signedArea(outline.points)).toBeGreaterThan(0);
}

describe("track outlines from Peter's local recordings", () => {
  it.skipIf(!iracingPath)(
    "builds the VIR outline from integrated velocity and heading",
    async () => {
      const { laps, outline, tracker, trackLengthM, msPerState } = await run(
        iracingStates(iracingPath as string),
      );
      expect(outline).not.toBeNull();
      if (outline === null) return;
      summarise("iRacing VIR", laps, outline);
      console.info(`iRacing: ${msPerState.toFixed(4)} ms per state in the Deriver, incl. track`);
      expect(outline.trackKey).toBe("iracing_virginia-international-raceway_full-course");
      expect(outline.source).toBe("integrated");
      expectGoodOutline(outline, trackLengthM);
      // The Ferrari file has well over ten clean laps; most of them build a usable outline.
      const good = laps.filter((l) => l.ok);
      expect(good.length).toBeGreaterThanOrEqual(8);
      for (const lap of good) if (lap.ok) expectGoodOutline(lap.outline, trackLengthM);
      expect(tracker.lastLap).not.toBeNull();
      expect(msPerState).toBeLessThan(1);
    },
    600_000,
  );

  it.skipIf(!lmuPath)(
    "builds the Le Mans outline from world positions",
    async () => {
      const { laps, outline, trackLengthM, msPerState } = await run(lmuStates(lmuPath as string));
      expect(outline).not.toBeNull();
      if (outline === null) return;
      summarise("LMU Le Mans", laps, outline);
      console.info(`LMU: ${msPerState.toFixed(4)} ms per state in the Deriver, incl. track`);
      expect(outline.trackKey).toBe("lmu_circuit-de-la-sarthe");
      expect(outline.source).toBe("world");
      expectGoodOutline(outline, trackLengthM);
      expect(msPerState).toBeLessThan(1);
    },
    600_000,
  );
});
