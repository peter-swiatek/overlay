import { parseReferenceMode, resolveReferenceKind } from "@overlay/sim-core/pure";
import type {
  BestTime,
  DeltaReferenceKind,
  DeltaReferenceMode,
  SectorState,
  SectorTiming,
  TelemetryFrame,
} from "@overlay/sim-core/types";
import { optionBoolean, optionNumber, optionString } from "../settings";
import type { OverlayInstanceSettings } from "../contract";
import { headToHead, type HeadToHead, type HeadToHeadCar } from "./head-to-head";

export type { HeadToHeadCar };

export type Tone = "gain" | "loss" | null;

/** The middle tile's bar: the ±range delta bar, or the track's official sectors. */
export type BarStyle = "delta" | "sectors";

export interface SectorSegment {
  /** Share of the lap (0..1); the segment's flex-grow. */
  lengthFrac: number;
  /** Null while not done (or done with neither a reference nor a best). */
  state: SectorState | null;
  done: boolean;
  deltaS: number | null;
  /** Wide enough (lengthFrac >= SECTOR_TEXT_MIN_FRAC) to print the delta inside. */
  showText: boolean;
  current: boolean;
  /** Car position within the current segment, 0..1; null for the others. */
  markerFrac: number | null;
}

export interface DeltaBarOptions {
  mode: DeltaReferenceMode;
  rangeS: 1 | 2 | 5;
  hideBelowKmh: number;
  showDeltaSpeed: boolean;
  showBestTimes: boolean;
  showHeadToHead: boolean;
  barStyle: BarStyle;
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
  /** Sector segments when the bar style is "sectors" and the track has sector data; else null. */
  sectors: SectorSegment[] | null;
}

/** A sector at least this share of the lap (about 32 px of the 464 px row) prints its delta. */
export const SECTOR_TEXT_MIN_FRAC = 0.07;

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
  sectors: null,
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

/** The segments for one reference kind; null without sector data. */
export function sectorSegments(
  timing: SectorTiming | null,
  kind: DeltaReferenceKind | null,
): SectorSegment[] | null {
  if (timing === null || timing.startPcts.length === 0) return null;
  const starts = timing.startPcts;
  const ref = timing.byReference[kind ?? "sessionBestClean"];
  const pct = finite(timing.lapDistPct);
  return starts.map((from, i) => {
    const to = starts[i + 1] ?? 1;
    const lengthFrac = Math.max(0, to - from);
    const current = timing.current === i;
    const deltaS = finite(ref?.deltas[i]);
    return {
      lengthFrac,
      state: ref?.states[i] ?? null,
      done: finite(timing.times[i]) !== null,
      deltaS,
      showText: deltaS !== null && lengthFrac >= SECTOR_TEXT_MIN_FRAC - 1e-9,
      current,
      markerFrac:
        current && pct !== null && lengthFrac > 0
          ? Math.min(1, Math.max(0, (pct - from) / lengthFrac))
          : null,
    };
  });
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
    sectors: options.barStyle === "sectors" ? sectorSegments(delta.sectors ?? null, kind) : null,
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
    barStyle: optionString(settings, "bar-style") === "sectors" ? "sectors" : "delta",
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
  sectors: null,
};

/** Four unequal sectors for the edit sample: two done, the car in the third. */
const SAMPLE_STARTS = [0, 0.27, 0.53, 0.78];
const SAMPLE_SECTORS: SectorTiming = {
  startPcts: SAMPLE_STARTS,
  current: 2,
  lapDistPct: 0.62,
  times: [27.31, 26.12, null, null],
  byReference: {
    allTimeBest: { deltas: [-0.21, 0.12, null, null], states: ["best", "loss", null, null] },
    sessionBestClean: { deltas: [-0.21, 0.12, null, null], states: ["best", "loss", null, null] },
    sessionBest: { deltas: [-0.21, 0.12, null, null], states: ["best", "loss", null, null] },
    lastLap: { deltas: [-0.3, -0.08, null, null], states: ["best", "gain", null, null] },
  },
};

/** The edit sample with the bar range and head-to-head toggle of the options applied. */
export function editSample(options: DeltaBarOptions): DeltaBarView {
  return {
    ...EDIT_SAMPLE,
    rangeS: options.rangeS,
    bar: barFill(EDIT_SAMPLE.deltaS, options.rangeS),
    headToHead: options.showHeadToHead ? EDIT_SAMPLE.headToHead : null,
    sectors:
      options.barStyle === "sectors"
        ? sectorSegments(SAMPLE_SECTORS, EDIT_SAMPLE.referenceKind)
        : null,
  };
}
