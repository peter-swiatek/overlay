import {
  GAP_DEFAULT_LAP_TIME_S,
  GAP_MINI_SECTOR_COUNT,
  type GapCarPosition,
  type GapLapTimeSource,
  type GapLapTimeSources,
  type GapReferenceLap,
  type GapReferences,
  type GapResult,
} from "./types";

/** `a mod m` with the result in [0, m). */
function mod(a: number, m: number): number {
  return a - m * Math.floor(a / m);
}

/** Wrap a lap-distance difference into (-0.5, 0.5]. */
export function wrapPctDiff(diff: number): number {
  return 0.5 - mod(0.5 - diff, 1);
}

/** Wrap a time difference into (-lapTimeS / 2, lapTimeS / 2]. */
export function wrapTimeDiff(diffS: number, lapTimeS: number): number {
  return lapTimeS / 2 - mod(lapTimeS / 2 - diffS, lapTimeS);
}

/** Linear interpolation of elapsed lap time at `lapDistPct` (0..1; wraps outside). */
export function elapsedAt(reference: GapReferenceLap, lapDistPct: number): number {
  const pos = mod(lapDistPct, 1) * GAP_MINI_SECTOR_COUNT;
  const i = Math.min(Math.floor(pos), GAP_MINI_SECTOR_COUNT - 1);
  const a = reference.times[i] ?? 0;
  const b = reference.times[i + 1] ?? reference.lapTimeS;
  return a + (pos - i) * (b - a);
}

function usable(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function pickLapTime(sources: GapLapTimeSources | undefined): {
  lapTimeS: number;
  source: GapLapTimeSource;
} {
  const chain: [GapLapTimeSource, number | undefined][] = [
    ["targetAverage", sources?.targetAverageS],
    ["targetBest", sources?.targetBestS],
    ["classBest", sources?.classBestS],
    ["sessionBest", sources?.sessionBestS],
  ];
  for (const [source, value] of chain) {
    if (usable(value)) return { lapTimeS: value, source };
  }
  return { lapTimeS: GAP_DEFAULT_LAP_TIME_S, source: "default" };
}

function onTrack(pct: number): boolean {
  return Number.isFinite(pct) && pct >= 0 && pct <= 1;
}

function validReference(ref: GapReferenceLap | undefined): ref is GapReferenceLap {
  return (
    ref !== undefined &&
    usable(ref.lapTimeS) &&
    ref.times.length === GAP_MINI_SECTOR_COUNT + 1 &&
    ref.times.every((t) => Number.isFinite(t))
  );
}

/**
 * Gap from the focus car to the target car; see the sign convention in `types.ts`
 * (negative = target ahead on track).
 */
export function relativeGap(
  focus: GapCarPosition,
  target: GapCarPosition,
  refs: GapReferences = {},
): GapResult {
  if (!onTrack(focus.lapDistPct) || !onTrack(target.lapDistPct)) return { tier: "unavailable" };
  const used = validReference(refs.targetReference)
    ? ({ reference: "target", lap: refs.targetReference } as const)
    : validReference(refs.trackReference)
      ? ({ reference: "track", lap: refs.trackReference } as const)
      : undefined;
  if (used) {
    const raw = elapsedAt(used.lap, focus.lapDistPct) - elapsedAt(used.lap, target.lapDistPct);
    return {
      tier: "miniSector",
      gapS: wrapTimeDiff(raw, used.lap.lapTimeS),
      reference: used.reference,
      referenceLapTimeS: used.lap.lapTimeS,
    };
  }
  const { lapTimeS, source } = pickLapTime(refs.lapTimes);
  return {
    tier: "position",
    gapS: wrapPctDiff(focus.lapDistPct - target.lapDistPct) * lapTimeS,
    lapTimeS,
    lapTimeSource: source,
  };
}
