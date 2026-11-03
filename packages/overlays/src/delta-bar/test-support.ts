import type { DeltaOutputs, TelemetryFrame } from "@overlay/sim-core/types";
import { fixtureFrame } from "../shared/fixtures";
import type { DeltaBarOptions } from "./view";

/** Test helpers: hand-made DeltaOutputs and frames (live values come from the Deriver). */
export const OPTIONS: DeltaBarOptions = {
  mode: "auto",
  rangeS: 2,
  hideBelowKmh: 35,
  showDeltaSpeed: true,
  showBestTimes: true,
  showHeadToHead: true,
};

export function deltaOutputs(over: Partial<DeltaOutputs> = {}): DeltaOutputs {
  return {
    references: {
      allTimeBest: { kind: "allTimeBest", lapTimeS: 99.4, hasTrace: true },
      sessionBestClean: { kind: "sessionBestClean", lapTimeS: 99.8, hasTrace: true },
      lastLap: { kind: "lastLap", lapTimeS: 100.1, hasTrace: true },
    },
    live: {
      allTimeBest: { deltaS: 0.6, rate: 0.2, speedDeltaMps: -1, source: "sim" },
      sessionBestClean: { deltaS: -0.42, rate: -0.3, speedDeltaMps: 1.1, source: "sim" },
      lastLap: { deltaS: 0.1, rate: 0, speedDeltaMps: 0.2, source: "computed" },
    },
    autoKind: "sessionBestClean",
    lapNumber: 5,
    currentLapS: 40,
    lastLapS: 100.06,
    outLap: false,
    closingLap: false,
    currentLapClean: true,
    allTimeBest: { lapTimeS: 99.4, lastLapDeltaS: 0.66, setByLastLap: false },
    sessionBest: { lapTimeS: 99.8, lastLapDeltaS: 0.26, setByLastLap: false },
    lastCompletion: null,
    lapCompleteVisible: false,
    optimalLapS: 99.1,
    ...over,
  };
}

export function liveFrame(
  delta: DeltaOutputs | null,
  opts: { speedKmh?: number | null; surface?: "onTrack" | "offTrack" } = {},
): TelemetryFrame {
  const f = fixtureFrame({
    playerCarIdx: 1,
    cars: [{ carIdx: 1 }],
    player: {
      speedMps: opts.speedKmh === null ? null : (opts.speedKmh ?? 150) / 3.6,
      trackSurface: opts.surface ?? "onTrack",
    },
  });
  f.derived.delta = delta;
  return f;
}
