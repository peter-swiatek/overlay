import { describe, expect, it } from "vitest";
import { defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { deltaOutputs, liveFrame, OPTIONS } from "./test-support";
import { deltaBarManifest } from "./manifest";
import {
  barFill,
  deltaBarView,
  deltaTone,
  EDIT_SAMPLE,
  editSample,
  readDeltaBarOptions,
  sectorSegments,
} from "./view";

describe("deltaBarView visibility", () => {
  it("is visible on track with delta data", () => {
    expect(deltaBarView(liveFrame(deltaOutputs()), OPTIONS, true).visible).toBe(true);
  });
  it("is hidden without a frame, when not live or without delta data", () => {
    expect(deltaBarView(null, OPTIONS, true).visible).toBe(false);
    const f = liveFrame(deltaOutputs());
    f.status = "waiting";
    expect(deltaBarView(f, OPTIONS, true).visible).toBe(false);
    expect(deltaBarView(liveFrame(null), OPTIONS, true).visible).toBe(false);
  });
  it("is hidden off track", () => {
    expect(
      deltaBarView(liveFrame(deltaOutputs(), { surface: "offTrack" }), OPTIONS, true).visible,
    ).toBe(false);
  });
  it("is hidden below the hide speed and uses the custom threshold", () => {
    expect(deltaBarView(liveFrame(deltaOutputs(), { speedKmh: 34 }), OPTIONS, true).visible).toBe(
      false,
    );
    expect(deltaBarView(liveFrame(deltaOutputs(), { speedKmh: 36 }), OPTIONS, true).visible).toBe(
      true,
    );
    const o = { ...OPTIONS, hideBelowKmh: 80 };
    expect(deltaBarView(liveFrame(deltaOutputs(), { speedKmh: 70 }), o, true).visible).toBe(false);
    expect(deltaBarView(liveFrame(deltaOutputs(), { speedKmh: 90 }), o, true).visible).toBe(true);
    expect(
      deltaBarView(
        liveFrame(deltaOutputs(), { speedKmh: 5 }),
        { ...OPTIONS, hideBelowKmh: 0 },
        true,
      ).visible,
    ).toBe(true);
  });
  it("counts an unknown speed as visible", () => {
    expect(deltaBarView(liveFrame(deltaOutputs(), { speedKmh: null }), OPTIONS, true).visible).toBe(
      true,
    );
  });
});

describe("deltaBarView reference", () => {
  it("auto follows autoKind", () => {
    const v = deltaBarView(liveFrame(deltaOutputs()), OPTIONS, true);
    expect(v.referenceKind).toBe("sessionBestClean");
    expect(v.referenceLapS).toBe(99.8);
    expect(v.deltaS).toBe(-0.42);
    expect(v.speedDeltaMps).toBe(1.1);
  });
  it("each override picks its kind, falling back to the last lap", () => {
    const f = liveFrame(deltaOutputs());
    expect(deltaBarView(f, { ...OPTIONS, mode: "allTimeBest" }, true).referenceKind).toBe(
      "allTimeBest",
    );
    expect(deltaBarView(f, { ...OPTIONS, mode: "sessionBest" }, true).referenceKind).toBe(
      "sessionBestClean",
    );
    expect(deltaBarView(f, { ...OPTIONS, mode: "lastLap" }, true).referenceKind).toBe("lastLap");
    const noBest = deltaOutputs();
    delete noBest.references.allTimeBest;
    delete noBest.references.sessionBestClean;
    const g = liveFrame(noBest);
    expect(deltaBarView(g, { ...OPTIONS, mode: "allTimeBest" }, true).referenceKind).toBe(
      "lastLap",
    );
    expect(deltaBarView(g, { ...OPTIONS, mode: "sessionBest" }, true).referenceKind).toBe(
      "lastLap",
    );
  });
  it("session best override uses the plain session best without a clean one", () => {
    const d = deltaOutputs();
    delete d.references.sessionBestClean;
    d.references.sessionBest = { kind: "sessionBest", lapTimeS: 99.7, hasTrace: false };
    const v = deltaBarView(liveFrame(d), { ...OPTIONS, mode: "sessionBest" }, true);
    expect(v.referenceKind).toBe("sessionBest");
    expect(v.referenceLapS).toBe(99.7);
  });
  it("has no reference and no delta when nothing is available", () => {
    const d = deltaOutputs({ references: {}, live: {}, autoKind: null });
    const v = deltaBarView(liveFrame(d), OPTIONS, true);
    expect(v.visible).toBe(true);
    expect(v.referenceKind).toBeNull();
    expect(v.deltaS).toBeNull();
    expect(v.predictedLapS).toBeNull();
    expect(v.bar).toEqual({ fraction: 0, tone: null });
  });
  it("shows no delta while the sim marks it invalid", () => {
    const d = deltaOutputs();
    d.live.sessionBestClean = { deltaS: null, rate: null, speedDeltaMps: null, source: null };
    const v = deltaBarView(liveFrame(d), OPTIONS, true);
    expect(v.deltaS).toBeNull();
    expect(v.tone).toBeNull();
    expect(v.trend).toBeNull();
  });
});

describe("deltaBarView delta, trend and bar", () => {
  it("tones by sign", () => {
    expect(deltaTone(-0.42)).toBe("gain");
    expect(deltaTone(0.42)).toBe("loss");
    expect(deltaTone(0)).toBeNull();
    expect(deltaTone(0.004)).toBeNull();
    expect(deltaTone(null)).toBeNull();
  });
  it("trend thresholds come from the rate, not the sign", () => {
    const at = (rate: number | null) => {
      const d = deltaOutputs();
      d.live.sessionBestClean = { deltaS: 0.5, rate, speedDeltaMps: null, source: "sim" };
      return deltaBarView(liveFrame(d), OPTIONS, true).trend;
    };
    expect(at(-0.3)).toBe("falling");
    expect(at(-0.0051)).toBe("falling");
    expect(at(-0.005)).toBeNull();
    expect(at(0)).toBeNull();
    expect(at(0.005)).toBeNull();
    expect(at(0.0051)).toBe("rising");
    expect(at(null)).toBeNull();
  });
  it("fills the bar per range and clamps", () => {
    expect(barFill(-0.5, 2)).toEqual({ fraction: 0.25, tone: "gain" });
    expect(barFill(0.5, 1)).toEqual({ fraction: 0.5, tone: "loss" });
    expect(barFill(0.5, 5)).toEqual({ fraction: 0.1, tone: "loss" });
    expect(barFill(-7, 2)).toEqual({ fraction: 1, tone: "gain" });
    expect(barFill(9, 5)).toEqual({ fraction: 1, tone: "loss" });
    expect(barFill(0, 2)).toEqual({ fraction: 0, tone: null });
    expect(barFill(null, 2)).toEqual({ fraction: 0, tone: null });
    const v = deltaBarView(liveFrame(deltaOutputs()), { ...OPTIONS, rangeS: 1 }, true);
    expect(v.rangeS).toBe(1);
    expect(v.bar.fraction).toBeCloseTo(0.42, 6);
  });
  it("predicts the lap as reference plus delta", () => {
    const v = deltaBarView(liveFrame(deltaOutputs()), OPTIONS, true);
    expect(v.predictedLapS).toBeCloseTo(99.38, 6);
  });
  it("passes the last lap, optimal and best times through", () => {
    const v = deltaBarView(liveFrame(deltaOutputs()), OPTIONS, true);
    expect(v.lastLapS).toBe(100.06);
    expect(v.optimalLapS).toBe(99.1);
    expect(v.allTimeBest.lapTimeS).toBe(99.4);
    expect(v.sessionBest.lastLapDeltaS).toBe(0.26);
  });
  it("hides the best deltas on closing and out laps", () => {
    expect(deltaBarView(liveFrame(deltaOutputs()), OPTIONS, true).bestDeltasHidden).toBe(false);
    expect(
      deltaBarView(liveFrame(deltaOutputs({ closingLap: true })), OPTIONS, true).bestDeltasHidden,
    ).toBe(true);
    expect(
      deltaBarView(liveFrame(deltaOutputs({ outLap: true })), OPTIONS, true).bestDeltasHidden,
    ).toBe(true);
  });
});

describe("deltaBarView lap complete", () => {
  const completion = (autoKind: "sessionBestClean" | "allTimeBest" | null) => ({
    lapNumber: 4,
    lapTimeS: 99.5,
    clean: true,
    references: { sessionBestClean: 99.8, allTimeBest: 99.2, lastLap: 100.1 },
    autoKind,
    completedAtS: 90,
  });
  it("compares the lap with the references of that lap (auto)", () => {
    const d = deltaOutputs({
      lastCompletion: completion("sessionBestClean"),
      lapCompleteVisible: true,
    });
    const v = deltaBarView(liveFrame(d), OPTIONS, true);
    expect(v.lapComplete?.lapTimeS).toBe(99.5);
    expect(v.lapComplete?.deltaS).toBeCloseTo(-0.3, 6);
    expect(v.lapComplete?.best).toBe(true);
  });
  it("uses the override mode against the snapshot", () => {
    const d = deltaOutputs({
      lastCompletion: completion("sessionBestClean"),
      lapCompleteVisible: true,
    });
    const v = deltaBarView(liveFrame(d), { ...OPTIONS, mode: "allTimeBest" }, true);
    expect(v.lapComplete?.deltaS).toBeCloseTo(0.3, 6);
    expect(v.lapComplete?.best).toBe(false);
  });
  it("follows the snapshot's own auto kind, not the current one", () => {
    const d = deltaOutputs({
      lastCompletion: completion("allTimeBest"),
      lapCompleteVisible: true,
      autoKind: "sessionBestClean",
    });
    const v = deltaBarView(liveFrame(d), OPTIONS, true);
    expect(v.lapComplete?.deltaS).toBeCloseTo(0.3, 6);
  });
  it("is absent when not visible or without a lap time", () => {
    const hidden = deltaOutputs({ lastCompletion: completion("sessionBestClean") });
    expect(deltaBarView(liveFrame(hidden), OPTIONS, true).lapComplete).toBeNull();
    const c = completion("sessionBestClean");
    const noTime = deltaOutputs({
      lastCompletion: { ...c, lapTimeS: null },
      lapCompleteVisible: true,
    });
    expect(deltaBarView(liveFrame(noTime), OPTIONS, true).lapComplete).toBeNull();
  });
  it("has a lap time but no delta when no reference existed", () => {
    const c = { ...completion(null), references: {} };
    const d = deltaOutputs({ lastCompletion: c, lapCompleteVisible: true });
    const v = deltaBarView(liveFrame(d), OPTIONS, true);
    expect(v.lapComplete).toEqual({ lapTimeS: 99.5, deltaS: null, best: false });
  });
});

describe("deltaBarView head-to-head", () => {
  it("is off with the option and shown in races from lap 2", () => {
    const f = fixtureFrame({
      playerCarIdx: 1,
      session: { type: "race" },
      player: { speedMps: 40, trackSurface: "onTrack" },
      cars: [
        { carIdx: 1, classId: "A" },
        { carIdx: 2, classId: "A" },
      ],
      standings: [
        { carIdx: 1, liveClassPosition: 2 },
        { carIdx: 2, liveClassPosition: 1 },
      ],
    });
    f.derived.delta = deltaOutputs();
    expect(deltaBarView(f, OPTIONS, true).headToHead?.ahead?.classPosition).toBe(1);
    expect(deltaBarView(f, { ...OPTIONS, showHeadToHead: false }, true).headToHead).toBeNull();
    f.derived.delta = deltaOutputs({ lapNumber: 1 });
    expect(deltaBarView(f, OPTIONS, true).headToHead).toBeNull();
  });
});

describe("readDeltaBarOptions", () => {
  it("reads the defaults", () => {
    expect(readDeltaBarOptions(defaultInstanceSettings(deltaBarManifest))).toEqual(OPTIONS);
  });
  it("reads changed options and maps junk to the defaults", () => {
    const s = defaultInstanceSettings(deltaBarManifest);
    s.options["reference"] = "lastLap";
    s.options["bar-range"] = "5";
    s.options["hide-below"] = 60;
    s.options["show-head-to-head"] = false;
    expect(readDeltaBarOptions(s)).toMatchObject({
      mode: "lastLap",
      rangeS: 5,
      hideBelowKmh: 60,
      showHeadToHead: false,
    });
    s.options["reference"] = "nonsense";
    s.options["bar-range"] = "3";
    expect(readDeltaBarOptions(s)).toMatchObject({ mode: "auto", rangeS: 2 });
  });
  it("reads the bar style, delta for anything but sectors", () => {
    const s = defaultInstanceSettings(deltaBarManifest);
    s.options["bar-style"] = "sectors";
    expect(readDeltaBarOptions(s).barStyle).toBe("sectors");
    s.options["bar-style"] = "zigzag";
    expect(readDeltaBarOptions(s).barStyle).toBe("delta");
  });
});

describe("sectorSegments", () => {
  const ref = { deltas: [-0.1, null, null], states: ["gain" as const, null, null] };
  const timing = {
    startPcts: [0, 0.5, 0.55],
    current: 1,
    lapDistPct: 0.51,
    times: [40, null, null],
    byReference: { allTimeBest: ref, sessionBestClean: ref, sessionBest: ref, lastLap: ref },
  };

  it("is null without sector data", () => {
    expect(sectorSegments(null, "lastLap")).toBeNull();
  });

  it("sizes segments by length and places the marker inside the current one", () => {
    const segs = sectorSegments(timing, "lastLap")!;
    expect(segs.map((x) => Number(x.lengthFrac.toFixed(3)))).toEqual([0.5, 0.05, 0.45]);
    expect(segs.map((x) => x.done)).toEqual([true, false, false]);
    expect(segs[0]).toMatchObject({ state: "gain", deltaS: -0.1, showText: true });
    expect(segs[1]!.current).toBe(true);
    expect(segs[1]!.markerFrac!).toBeCloseTo(0.2, 6);
    expect(segs[2]!.markerFrac).toBeNull();
  });

  it("is only built for the sectors bar style", () => {
    const d = deltaOutputs({ sectors: timing });
    expect(deltaBarView(liveFrame(d), OPTIONS, true).sectors).toBeNull();
    const v = deltaBarView(liveFrame(d), { ...OPTIONS, barStyle: "sectors" }, true);
    expect(v.sectors).toHaveLength(3);
  });
});

describe("EDIT_SAMPLE", () => {
  it("is the board's gaining scenario", () => {
    expect(EDIT_SAMPLE.deltaS).toBe(-0.42);
    expect(EDIT_SAMPLE.trend).toBe("falling");
    expect(EDIT_SAMPLE.predictedLapS).toBeCloseTo(
      (EDIT_SAMPLE.referenceLapS ?? 0) + (EDIT_SAMPLE.deltaS ?? 0),
      6,
    );
    expect(EDIT_SAMPLE.headToHead?.ahead?.classPosition).toBe(2);
    expect(EDIT_SAMPLE.headToHead?.behind?.classPosition).toBe(4);
  });
  it("follows the range and head-to-head options", () => {
    const o = { ...OPTIONS, rangeS: 5 as const, showHeadToHead: false };
    const s = editSample(o);
    expect(s.rangeS).toBe(5);
    expect(s.bar.fraction).toBeCloseTo(0.084, 6);
    expect(s.headToHead).toBeNull();
  });
});
