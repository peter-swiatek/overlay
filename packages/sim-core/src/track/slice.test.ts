import { describe, expect, it } from "vitest";
import { FIXTURE_DIR, loadSlice, toStates } from "../adapters/iracing/slice-support";
import { Deriver } from "../telemetry/derive";
import { TrackOutlineBuilder } from "./builder";
import { toSample } from "./tracker";

describe("the committed S/F crossing slice (20 s of VIR)", async () => {
  const slice = await loadSlice(`${FIXTURE_DIR}iracing-ferrari-sf-crossing-20s.ovfx`);
  const states = toStates(slice);

  it("cannot build a lap: it reports the lap as incomplete", () => {
    const builder = new TrackOutlineBuilder({ trackKey: "iracing_vir", trackLengthM: 5216.9 });
    const results = [];
    for (const state of states) {
      const player = state.cars.find((c) => c.carIdx === state.playerCarIdx) ?? null;
      const sample = toSample(state, player);
      if (sample === null) continue;
      const result = builder.push(sample);
      if (result !== null) results.push(result);
    }
    // The line is crossed once, ending a lap that began long before the slice did.
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, reason: "incomplete" });
    // And the lap after it is just a few seconds old.
    expect(builder.finishNow()).toMatchObject({ ok: false, reason: "incomplete" });
  });

  it("gives the Deriver a track key but no outline", () => {
    const deriver = new Deriver();
    const outputs = states.map((state) => deriver.next(state));
    expect(outputs.at(-1)?.track).toEqual({
      trackKey: "iracing_virginia-international-raceway_full-course",
      outlineReady: false,
      pitExitLapDistPct: null,
      pitExitDistanceM: null,
    });
    expect(deriver.trackOutline).toBeNull();
    expect(deriver.trackTracker.lastLap).toMatchObject({ ok: false, reason: "incomplete" });
  });
});
