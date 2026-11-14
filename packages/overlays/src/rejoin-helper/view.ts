import { SLOW_MPS } from "@overlay/sim-core/pure";
import type { Car, SessionInfo, TelemetryFrame } from "@overlay/sim-core/types";

/*
 * Rejoin Helper view model: after a spin or an off, how long until the next car coming up behind
 * reaches the player's spot on track, and whether it is safe to rejoin.
 *
 * The gap is sim-core's relative gap to each car (`derived.gaps`): the time that car needs, at its
 * own recorded pace through this part of the lap, to reach the player's track position. It is
 * not distance over the car's speed now: a car braking for a corner behind would read too far
 * away by that measure, and the recorded pace errs on the side of the car arriving sooner.
 *
 * - iRacing: off track from the player's track surface, slow or stopped from the player's speed.
 * - LMU: slow or stopped only; the sim gives no off-track surface for the player.
 */

/** A car further behind than this does not count as coming up behind, seconds. */
export const NEXT_CAR_RANGE_S = 30;
/** The player must need to rejoin this long before the panel shows, seconds. */
export const SHOW_AFTER_S = 0.5;
/** Once back up to speed on track the panel stays this long, seconds. */
export const HIDE_AFTER_S = 2;

/** Phases with no racing traffic: standing grid, pace laps, garage and the cool-down lap. */
const QUIET_PHASES: ReadonlySet<SessionInfo["phase"]> = new Set([
  "garage",
  "gridding",
  "formation",
  "cooldown",
]);

export type RejoinTone = "red" | "yellow" | "clear";

export interface RejoinOptions {
  /** Below this many seconds the panel is red (do not rejoin). */
  redS: number;
  /** Below this many seconds the panel is yellow (caution). */
  cautionS: number;
  /** Show whenever there is a live frame, for testing. */
  alwaysShow: boolean;
}

export interface RejoinView {
  tone: RejoinTone;
  /** Seconds with one decimal, e.g. "1.4"; "--" when no car is coming within range. */
  gap: string;
  /** "DO NOT REJOIN", "CAUTION" or "CLEAR TO REJOIN". */
  condition: string;
}

const CONDITIONS: Readonly<Record<RejoinTone, string>> = {
  red: "DO NOT REJOIN",
  yellow: "CAUTION",
  clear: "CLEAR TO REJOIN",
};

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A car that can come up behind the player: on track, in the world, not in the pits. */
function racing(car: Car): boolean {
  return (
    car.connected &&
    car.isPaceCar !== true &&
    car.isOnTrack !== false &&
    car.onPitRoad !== true &&
    car.inPitStall !== true &&
    car.trackSurface !== "notInWorld" &&
    car.trackSurface !== "offTrack" &&
    car.trackSurface !== "inPitStall"
  );
}

/**
 * Seconds until the nearest car behind (any class) reaches the player's track position; null when
 * none is within {@link NEXT_CAR_RANGE_S}.
 */
export function nextCarBehindS(frame: TelemetryFrame): number | null {
  const cars = new Map(frame.state.cars.map((c) => [c.carIdx, c]));
  let best: number | null = null;
  for (const gap of frame.derived.gaps) {
    const s = finite(gap.gapS);
    // Positive gaps are cars behind on track (see sim-core calc/gaps).
    if (s === null || s < 0 || s > NEXT_CAR_RANGE_S) continue;
    const car = cars.get(gap.carIdx);
    if (car === undefined || car.carIdx === frame.state.playerCarIdx || !racing(car)) continue;
    if (best === null || s < best) best = s;
  }
  return best;
}

/** Where the player is, for the panel: not driving (or in the pits), driving, off, or slow. */
export type PlayerSituation = "away" | "driving" | "off" | "slow";

export function playerSituation(frame: TelemetryFrame): PlayerSituation {
  const { state } = frame;
  const phase = state.session.phase;
  if (phase !== null && QUIET_PHASES.has(phase)) return "away";
  const car = state.cars.find((c) => c.carIdx === state.playerCarIdx) ?? null;
  if (car === null || car.lapDistPct === null) return "away";
  const player = state.player;
  if (player.isOnTrack === false || car.isOnTrack === false) return "away";
  if (car.onPitRoad === true || car.inPitStall === true) return "away";
  const surface = player.trackSurface ?? car.trackSurface;
  if (surface === "notInWorld" || surface === "inPitStall" || surface === "approachingPits") {
    return "away";
  }
  if (surface === "offTrack") return "off";
  const speed = finite(player.speedMps);
  return speed !== null && speed < SLOW_MPS ? "slow" : "driving";
}

/** Remembers whether the player has been up to speed and how long they have needed to rejoin. */
export interface RejoinMemory {
  /** Seen at or above the slow speed on track since the player last came out of the pits. */
  fast: boolean;
  /** When the player began to need to rejoin, seconds on the caller's clock; null while not. */
  needSinceS: number | null;
  /** When the player was last back up to speed while the panel showed; null while not. */
  clearSinceS: number | null;
  shown: boolean;
  lastS: number | null;
}

export function newRejoinMemory(): RejoinMemory {
  return { fast: false, needSinceS: null, clearSinceS: null, shown: false, lastS: null };
}

/**
 * Steps the memory and says whether the panel shows: after the player has been off track, or
 * slow on track having been up to speed (so not on a standing grid or leaving the pits), for
 * {@link SHOW_AFTER_S}; until they have been back up to speed for {@link HIDE_AFTER_S}.
 */
export function stepRejoinVisibility(
  memory: RejoinMemory,
  situation: PlayerSituation,
  nowS: number,
): boolean {
  if (memory.lastS !== null && nowS < memory.lastS) Object.assign(memory, newRejoinMemory());
  memory.lastS = nowS;
  if (situation === "away") {
    Object.assign(memory, newRejoinMemory(), { lastS: nowS });
    return false;
  }
  if (situation === "driving") memory.fast = true;
  const need = situation === "off" || (situation === "slow" && memory.fast);
  if (need) {
    memory.clearSinceS = null;
    memory.needSinceS ??= nowS;
    if (nowS - memory.needSinceS >= SHOW_AFTER_S) memory.shown = true;
  } else {
    memory.needSinceS = null;
    if (memory.shown) {
      memory.clearSinceS ??= nowS;
      if (nowS - memory.clearSinceS >= HIDE_AFTER_S) {
        memory.shown = false;
        memory.clearSinceS = null;
      }
    }
  }
  return memory.shown;
}

/** Red below the red threshold, yellow below the caution one, else clear; clear with no car. */
export function rejoinTone(
  gapS: number | null,
  options: Omit<RejoinOptions, "alwaysShow">,
): RejoinTone {
  if (gapS === null) return "clear";
  if (gapS < options.redS) return "red";
  if (gapS < options.cautionS) return "yellow";
  return "clear";
}

export function rejoinViewFor(
  gapS: number | null,
  options: Omit<RejoinOptions, "alwaysShow">,
): RejoinView {
  const tone = rejoinTone(gapS, options);
  return { tone, gap: gapS === null ? "--" : gapS.toFixed(1), condition: CONDITIONS[tone] };
}

/** Null without a live frame or while the player does not need to rejoin (unless always shown). */
export function rejoinView(
  frame: TelemetryFrame | null,
  memory: RejoinMemory,
  nowS: number,
  options: RejoinOptions,
): RejoinView | null {
  if (frame === null || frame.status !== "live") return null;
  const shown = stepRejoinVisibility(memory, playerSituation(frame), nowS);
  if (!shown && !options.alwaysShow) return null;
  return rejoinViewFor(nextCarBehindS(frame), options);
}

/** The design's sample for edit mode: a car 1.4 s behind, do not rejoin. */
export function sampleRejoinView(): RejoinView {
  return { tone: "red", gap: "1.4", condition: CONDITIONS.red };
}
