import { computeRefuel } from "@overlay/sim-core/pure";
import type { Car, DeltaReferenceKind, TelemetryFrame } from "@overlay/sim-core/types";
import {
  formatDelta,
  formatLapTime,
  formatPercent,
  formatSessionTime,
  formatSpeed,
  formatTemperature,
  formatVolume,
  toFixedClean,
} from "@overlay/ui/format";
import type { DisplayPrefs } from "@overlay/ui/types";
import { driverRows, focusCarIdx } from "../shared";
import { metricAvailable, metricById, type MetricDef, type MetricId } from "./metrics";

/** Colour of the big value: theme accent (brake bias), or the locked gain / loss colours (delta). */
export type ValueTone = "accent" | "gain" | "loss" | null;

/** What one tile draws. */
export interface TileView {
  metric: string;
  /** Small label, top left (drawn in uppercase). */
  label: string;
  /** Big value, bottom left; "--" when unknown. */
  value: string;
  /** Drawn as the position chip in the class colour ("P3"). */
  chip: boolean;
  /** CSS hex colour of the chip's class; null falls back to the theme accent. */
  classColour: string | null;
  valueTone: ValueTone;
  /** Small value, bottom right; null hides it. */
  secondary: string | null;
  /** Fuel still needed to finish is drawn in the locked loss colour. */
  secondaryTone: "loss" | null;
}

export interface TileContext {
  prefs: DisplayPrefs;
  livePositions: boolean;
  /** Brake bias at the start of the session or stint (see `trackBiasBase`). */
  biasBase: number | null;
}

/** What the overlay remembers between frames: the brake bias to compare with. */
export interface BiasMemory {
  sessionKey: string | null;
  base: number | null;
}

export const newBiasMemory = (): BiasMemory => ({ sessionKey: null, base: null });

const UNKNOWN = "--";

function blank(def: MetricDef): TileView {
  return {
    metric: def.id,
    label: def.label,
    value: UNKNOWN,
    chip: false,
    classColour: null,
    valueTone: null,
    secondary: null,
    secondaryTone: null,
  };
}

function playerCar(frame: TelemetryFrame): Car | undefined {
  const idx = focusCarIdx(frame.state);
  return idx === null ? undefined : frame.state.cars.find((c) => c.carIdx === idx);
}

/**
 * Keeps the brake bias the change is measured from: the value when the session began or the
 * stint began. It follows the current value while the player is in the garage or the pit stall
 * (where a setup or a stop may change it), and is cleared when the session changes.
 */
export function trackBiasBase(frame: TelemetryFrame | null, memory: BiasMemory): number | null {
  if (frame === null || frame.status !== "live") return memory.base;
  const { session, player } = frame.state;
  const key = `${session.type ?? ""}|${session.typeName ?? ""}`;
  if (memory.sessionKey !== key) {
    memory.sessionKey = key;
    memory.base = null;
  }
  const bias = player.brakeBias;
  if (bias === null) return memory.base;
  const parked = player.isOnTrack === false || playerCar(frame)?.inPitStall === true;
  if (parked || memory.base === null) memory.base = bias;
  return memory.base;
}

/** "+0.2%" against the base, in percentage points; null when unknown or unchanged at 0.1. */
export function biasChangeText(bias: number | null, base: number | null): string | null {
  if (bias === null || base === null) return null;
  const points = Math.round((bias - base) * 1000) / 10;
  if (points === 0) return null;
  return `${points > 0 ? "+" : "-"}${toFixedClean(Math.abs(points), 1)}%`;
}

/**
 * Fuel still needed to reach the finish beyond what is in the tank, by the Fuel Calculator's
 * refuel formula (session average per lap, laps to go) with no safety margin and no tank cap;
 * null when nothing is short or it is unknown.
 */
export function fuelShortL(frame: TelemetryFrame): number | null {
  const fuel = frame.derived.fuel;
  if (fuel === null) return null;
  const short = computeRefuel({
    lapsToGo: fuel.lapsToGo,
    perLap: fuel.fuelAvgLap,
    currentFuel: frame.state.player.fuelL,
    safetyMarginLaps: 0,
    tankCapacity: null,
  });
  return short === null || short < 0.05 ? null : short;
}

const DELTA_VS: Record<DeltaReferenceKind, string> = {
  allTimeBest: "vs All-time",
  sessionBestClean: "vs Session",
  sessionBest: "vs Session",
  lastLap: "vs Last",
};

function gearText(gear: number | null): string {
  if (gear === null) return UNKNOWN;
  if (gear < 0) return "R";
  return gear === 0 ? "N" : String(gear);
}

/** "31.0°" in the user's units; "--" unknown. */
function degrees(celsius: number | null, prefs: DisplayPrefs, decimals: 0 | 1): string {
  const m = formatTemperature(celsius, prefs, decimals);
  return m.value === UNKNOWN ? UNKNOWN : `${m.value}°`;
}

function positionTile(
  def: MetricDef,
  frame: TelemetryFrame,
  ctx: TileContext,
  inClass: boolean,
): TileView {
  const rows = driverRows(frame, {
    livePositions: ctx.livePositions,
    gapDecimals: 1,
    lapDecimals: 3,
  });
  const own = rows.find((r) => r.isFocus);
  const tile = blank(def);
  if (own === undefined) return tile;
  const position = inClass ? own.position : own.overallPosition;
  const field = inClass ? rows.filter((r) => r.classKey === own.classKey).length : rows.length;
  const of = inClass && own.className !== null ? `of ${field} ${own.className}` : `of ${field}`;
  return {
    ...tile,
    value: position === null ? UNKNOWN : `P${position}`,
    chip: position !== null,
    classColour: own.classColour,
    secondary: position === null ? null : of,
  };
}

/** One tile for `metricId` from the frame; "--" when the frame, the sim or the data lacks it. */
export function tileView(
  metricId: string,
  frame: TelemetryFrame | null,
  ctx: TileContext,
): TileView | null {
  const def = metricById(metricId);
  if (def === undefined) return null;
  const tile = blank(def);
  if (frame === null || frame.status !== "live") return tile;
  const { state, derived } = frame;
  if (!metricAvailable(def, state.sim)) return tile;
  const { player, session, conditions } = state;
  const { prefs } = ctx;
  const id = def.id as MetricId;

  switch (id) {
    case "class-position":
      return positionTile(def, frame, ctx, true);
    case "position":
      return positionTile(def, frame, ctx, false);
    case "lap": {
      const lap = playerCar(frame)?.lapInProgress ?? null;
      if (lap === null) return tile;
      const total = session.lapsTotal;
      return { ...tile, value: String(lap), secondary: total === null ? null : `of ${total}` };
    }
    case "remaining": {
      const time = session.timeRemainingS;
      const laps = session.lapsRemaining;
      const lapsText = laps === null ? null : `${laps} ${laps === 1 ? "lap" : "laps"}`;
      if (time !== null) return { ...tile, value: formatSessionTime(time), secondary: lapsText };
      if (laps !== null) return { ...tile, value: String(laps), secondary: "laps" };
      return tile;
    }
    case "last-lap": {
      const last = player.lap?.lastLapS ?? null;
      const best = player.lap?.bestLapS ?? null;
      const value = formatLapTime(last, 3);
      if (value === UNKNOWN || last === null) return tile;
      return { ...tile, value, secondary: best === null ? null : formatDelta(last - best, 3) };
    }
    case "best-lap":
      return { ...tile, value: formatLapTime(player.lap?.bestLapS ?? null, 3) };
    case "delta": {
      const delta = derived.delta;
      const kind = delta?.autoKind ?? null;
      const s = kind === null ? null : (delta?.live[kind]?.deltaS ?? null);
      if (kind === null || s === null) return tile;
      const value = formatDelta(s, 2);
      const rounded = Number(value);
      const valueTone: ValueTone = rounded < 0 ? "gain" : rounded > 0 ? "loss" : null;
      return { ...tile, value, valueTone, secondary: DELTA_VS[kind] };
    }
    case "brake-bias": {
      const bias = player.brakeBias;
      if (bias === null) return tile;
      return {
        ...tile,
        value: formatPercent(bias, 1),
        valueTone: "accent",
        secondary: biasChangeText(bias, ctx.biasBase),
      };
    }
    case "fuel-level": {
      const level = formatVolume(player.fuelL, prefs, 1);
      if (level.value === UNKNOWN) return tile;
      const short = formatVolume(fuelShortL(frame), prefs, 1);
      return {
        ...tile,
        value: `${level.value} ${level.unit}`,
        secondary: short.value === UNKNOWN ? null : `${short.value}${short.unit}`,
        secondaryTone: short.value === UNKNOWN ? null : "loss",
      };
    }
    case "fuel-laps": {
      const fuel = derived.fuel;
      const left = fuel?.lapsRemainingAvg ?? null;
      if (fuel === null || left === null) return tile;
      const perLap = formatVolume(fuel.fuelAvgLap, prefs, 2);
      return {
        ...tile,
        value: toFixedClean(left, 1),
        secondary: perLap.value === UNKNOWN ? null : `${perLap.value} ${perLap.unit}/lap`,
      };
    }
    case "energy": {
      const value = formatPercent(player.energyFraction, 1);
      if (value === UNKNOWN) return tile;
      const left = derived.energy?.lapsRemainingAvg ?? null;
      return { ...tile, value, secondary: left === null ? null : `${toFixedClean(left, 1)} laps` };
    }
    case "track-temp": {
      const value = degrees(conditions.trackTempC, prefs, 1);
      if (value === UNKNOWN) return tile;
      const air = degrees(conditions.airTempC, prefs, 0);
      return { ...tile, value, secondary: air === UNKNOWN ? null : `Air ${air}` };
    }
    case "air-temp": {
      const value = degrees(conditions.airTempC, prefs, 1);
      if (value === UNKNOWN) return tile;
      const track = degrees(conditions.trackTempC, prefs, 0);
      return { ...tile, value, secondary: track === UNKNOWN ? null : `Track ${track}` };
    }
    case "speed": {
      const speed = formatSpeed(player.speedMps, prefs, 0);
      if (speed.value === UNKNOWN) return tile;
      return { ...tile, value: speed.value, secondary: speed.unit };
    }
    case "gear": {
      const rpm = player.rpm;
      return {
        ...tile,
        value: gearText(player.gear),
        secondary: player.gear === null || rpm === null ? null : `${Math.round(rpm)} rpm`,
      };
    }
    case "incidents": {
      const count = player.incidentCount;
      if (count === null) return tile;
      const limit = session.incidentLimit;
      return { ...tile, value: `${count}x`, secondary: limit === null ? null : `of ${limit}x` };
    }
  }
}

/** The tiles shown, in order: the first `count` tile metrics. */
export function dataFramesView(
  metrics: readonly string[],
  frame: TelemetryFrame | null,
  ctx: TileContext,
): TileView[] {
  const tiles: TileView[] = [];
  for (const id of metrics) {
    const tile = tileView(id, frame, ctx);
    if (tile !== null) tiles.push(tile);
  }
  return tiles;
}

/** Edit mode without data: the design board's values, so the layout can be placed. */
const SAMPLES: Record<MetricId, Partial<TileView>> = {
  "class-position": { value: "P3", chip: true, classColour: null, secondary: "of 16 GT3" },
  position: { value: "P7", chip: true, classColour: null, secondary: "of 32" },
  lap: { value: "12", secondary: "of 30" },
  remaining: { value: "42:10", secondary: null },
  "last-lap": { value: "1:40.150", secondary: "+0.312" },
  "best-lap": { value: "1:39.838" },
  delta: { value: "-0.21", valueTone: "gain", secondary: "vs Session" },
  "brake-bias": { value: "54.2%", valueTone: "accent", secondary: "+0.2%" },
  "fuel-level": { value: "47.0 L", secondary: "19.6L", secondaryTone: "loss" },
  "fuel-laps": { value: "16.6", secondary: "2.84 L/lap" },
  energy: { value: "62.4%", secondary: "8.1 laps" },
  "track-temp": { value: "31.0°", secondary: "Air 22°" },
  "air-temp": { value: "22.0°", secondary: "Track 31°" },
  speed: { value: "212", secondary: "km/h" },
  gear: { value: "4", secondary: "7450 rpm" },
  incidents: { value: "4x", secondary: "of 17x" },
};

export function sampleTiles(metrics: readonly string[]): TileView[] {
  const tiles: TileView[] = [];
  for (const id of metrics) {
    const def = metricById(id);
    if (def !== undefined) tiles.push({ ...blank(def), ...SAMPLES[def.id as MetricId] });
  }
  return tiles;
}
