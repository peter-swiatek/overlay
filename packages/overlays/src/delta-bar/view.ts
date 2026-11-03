import { parseReferenceMode, resolveReferenceKind } from "@overlay/sim-core/pure";
import type {
  BestTime,
  DeltaReferenceKind,
  DeltaReferenceMode,
  TelemetryFrame,
} from "@overlay/sim-core/types";
import { optionBoolean, optionNumber, optionString } from "../settings";
import type { OverlayInstanceSettings } from "../contract";
import { headToHead, type HeadToHead, type HeadToHeadCar } from "./head-to-head";

export type { HeadToHeadCar };

export type Tone = "gain" | "loss" | null;

export interface DeltaBarOptions {
  mode: DeltaReferenceMode;
  rangeS: 1 | 2 | 5;
  hideBelowKmh: number;
  showDeltaSpeed: boolean;
  showBestTimes: boolean;
  showHeadToHead: boolean;
}

export interface DeltaBarView {
  /** False: render nothing (not live, off track, below the hide speed, no delta data) unless editing. */
  visible: boolean;
  referenceKind: DeltaReferenceKind | null;
  referenceLapS: number | null;
  deltaS: number | null;
  tone: Tone;
  /** From the rate: "falling" (gaining, arrow down, gain) below -0.005 s/s, "rising" above +0.005. */
  trend: "falling" | "rising" | null;
  speedDeltaMps: number | null;
  /** Bar: share of half the bar (0..1) and the side it grows to. */
  bar: { fraction: number; tone: Tone };
  rangeS: 1 | 2 | 5;
  predictedLapS: number | null; // reference lap + deltaS
  lastLapS: number | null;
  optimalLapS: number | null;
  allTimeBest: BestTime;
  sessionBest: BestTime;
  /** Hide the best-time deltas (closing lap or out lap). */
  bestDeltasHidden: boolean;
  lapComplete: { lapTimeS: number; deltaS: number | null; best: boolean } | null;
  headToHead: HeadToHead | null;
}

/** Rate (s/s) beyond which the trend arrow shows. */
export const TREND_THRESHOLD = 0.005;

const NO_BEST: BestTime = { lapTimeS: null, lastLapDeltaS: null, setByLastLap: false };

const INACTIVE: DeltaBarView = {
  visible: false,
  referenceKind: null,
  referenceLapS: null,
  deltaS: null,
  tone: null,
  trend: null,
  speedDeltaMps: null,
  bar: { fraction: 0, tone: null },
  rangeS: 2,
  predictedLapS: null,
  lastLapS: null,
  optimalLapS: null,
  allTimeBest: NO_BEST,
  sessionBest: NO_BEST,
  bestDeltasHidden: false,
  lapComplete: null,
  headToHead: null,
};

const finite = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

/** Gain below zero, loss above; a delta that prints as 0.00 has no tone. */
export function deltaTone(deltaS: number | null): Tone {
  if (deltaS === null) return null;
  const rounded = Math.round(deltaS * 100) / 100;
  if (rounded < 0) return "gain";
  if (rounded > 0) return "loss";
  return null;
}

/** Bar fill: |delta| over the range, 0..1, on the side the tone says. */
export function barFill(deltaS: number | null, rangeS: number): DeltaBarView["bar"] {
  if (deltaS === null) return { fraction: 0, tone: null };
  const fraction = Math.min(1, Math.abs(deltaS) / rangeS);
  return { fraction, tone: deltaS < 0 ? "gain" : deltaS > 0 ? "loss" : null };
}

export function deltaBarView(
  frame: TelemetryFrame | null,
  options: DeltaBarOptions,
  livePositions: boolean,
): DeltaBarView {
  if (frame === null || frame.status !== "live") return INACTIVE;
  const { state, derived } = frame;
  const delta = derived.delta;
  if (delta === null) return INACTIVE;
  if (state.player.trackSurface === "offTrack") return INACTIVE;
  const speed = finite(state.player.speedMps);
  if (speed !== null && speed * 3.6 < options.hideBelowKmh) return INACTIVE;

  const kind = resolveReferenceKind(options.mode, delta.autoKind, delta.references);
  const reference = kind === null ? null : (delta.references[kind] ?? null);
  const live = kind === null ? null : (delta.live[kind] ?? null);
  const deltaS = finite(live?.deltaS);
  const rate = finite(live?.rate);
  const referenceLapS = reference === null ? null : reference.lapTimeS;

  let lapComplete: DeltaBarView["lapComplete"] = null;
  const completion = delta.lastCompletion;
  if (delta.lapCompleteVisible && completion !== null && completion.lapTimeS !== null) {
    const lapKind = resolveReferenceKind(options.mode, completion.autoKind, completion.references);
    const ref = lapKind === null ? undefined : completion.references[lapKind];
    const diff = ref === undefined ? null : completion.lapTimeS - ref;
    lapComplete = { lapTimeS: completion.lapTimeS, deltaS: diff, best: diff !== null && diff < 0 };
  }

  return {
    visible: true,
    referenceKind: kind,
    referenceLapS,
    deltaS,
    tone: deltaTone(deltaS),
    trend:
      rate === null
        ? null
        : rate < -TREND_THRESHOLD
          ? "falling"
          : rate > TREND_THRESHOLD
            ? "rising"
            : null,
    speedDeltaMps: finite(live?.speedDeltaMps),
    bar: barFill(deltaS, options.rangeS),
    rangeS: options.rangeS,
    predictedLapS: referenceLapS !== null && deltaS !== null ? referenceLapS + deltaS : null,
    lastLapS: finite(delta.lastLapS),
    optimalLapS: finite(delta.optimalLapS),
    allTimeBest: delta.allTimeBest,
    sessionBest: delta.sessionBest,
    bestDeltasHidden: delta.closingLap || delta.outLap,
    lapComplete,
    headToHead: options.showHeadToHead
      ? headToHead(state, derived.standings, delta.lapNumber, livePositions)
      : null,
  };
}

const RANGES: readonly (1 | 2 | 5)[] = [1, 2, 5];

export function readDeltaBarOptions(settings: OverlayInstanceSettings): DeltaBarOptions {
  const range = Number(optionString(settings, "bar-range"));
  return {
    mode: parseReferenceMode(optionString(settings, "reference")),
    rangeS: RANGES.find((r) => r === range) ?? 2,
    hideBelowKmh: optionNumber(settings, "hide-below"),
    showDeltaSpeed: optionBoolean(settings, "show-delta-speed"),
    showBestTimes: optionBoolean(settings, "show-best-times"),
    showHeadToHead: optionBoolean(settings, "show-head-to-head"),
  };
}

/** Shown while editing when there is no live delta: the board's race, gaining scenario. */
export const EDIT_SAMPLE: DeltaBarView = {
  visible: true,
  referenceKind: "sessionBestClean",
  referenceLapS: 99.82,
  deltaS: -0.42,
  tone: "gain",
  trend: "falling",
  speedDeltaMps: 4 / 3.6,
  bar: { fraction: 0.21, tone: "gain" },
  rangeS: 2,
  predictedLapS: 99.4,
  lastLapS: 100.06,
  optimalLapS: 99.12,
  allTimeBest: { lapTimeS: 99.41, lastLapDeltaS: 0.56, setByLastLap: false },
  sessionBest: { lapTimeS: 99.82, lastLapDeltaS: 0.15, setByLastLap: false },
  bestDeltasHidden: false,
  lapComplete: null,
  headToHead: {
    ahead: {
      classPosition: 2,
      classColour: "#f59e0b",
      carNumber: "12",
      name: "A. Sample",
      gapText: "-1.2",
      lastLapDiffS: 0.31,
    },
    behind: {
      classPosition: 4,
      classColour: "#f59e0b",
      carNumber: "27",
      name: "B. Example",
      gapText: "+0.9",
      lastLapDiffS: -0.18,
    },
  },
};

/** The edit sample with the bar range and head-to-head toggle of the options applied. */
export function editSample(options: DeltaBarOptions): DeltaBarView {
  return {
    ...EDIT_SAMPLE,
    rangeS: options.rangeS,
    bar: barFill(EDIT_SAMPLE.deltaS, options.rangeS),
    headToHead: options.showHeadToHead ? EDIT_SAMPLE.headToHead : null,
  };
}
