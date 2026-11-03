import type { TelemetryFrame } from "@overlay/sim-core/types";
import {
  clamp01,
  shiftLightPoints,
  shiftLightState,
  type ShiftLightSource,
  type ShiftLightState,
} from "../shared/driving";

/** Distance of the nearest car alongside: < 5 m, < 10 m, < 17 m. */
export type ProximityLevel = "close" | "near" | "far";
/** You are lapping that car (blue) / it is a lap or more up (red). */
export type LapLine = "lapping" | "lapped";

export interface HudGap {
  /** Seconds, always positive; the tab prints "+1.2" ahead and "-0.8" behind. */
  gapS: number;
  lapLine: LapLine | null;
}
export type HudStatus =
  | { kind: "slow"; distanceM: number }
  | { kind: "pit"; distanceM: number; /** 0 at 500 m .. 1 at the box. */ fill: number };

export interface CompactHudView {
  /** False when not live or the player is not on track: the overlay renders nothing unless editing. */
  active: boolean;
  speedMps: number | null;
  gear: number | null;
  rpm: number | null;
  lights: ShiftLightState;
  /** 0..1 */
  throttle: number;
  brake: number;
  abs: boolean;
  limiter: boolean;
  /** Steering dot left edge in px, 0..216 (108 = straight). */
  pinPx: number;
  ahead: HudGap | null;
  behind: HudGap | null;
  proximityAhead: ProximityLevel | null;
  proximityBehind: ProximityLevel | null;
  status: HudStatus | null;
}

export interface HudOptions {
  gapRangeS: number;
  showGapTabs: boolean;
  showProximity: boolean;
  showPitCountdown: boolean;
  showSlowCar: boolean;
  slowCarRangeM: number;
  shiftSource: ShiftLightSource;
}

/** Shift-light steps (pairs) in the HUD. */
export const HUD_LIGHT_STEPS = 6;
/** The pit pill appears when the stall is at most this far ahead, metres. */
export const PIT_COUNTDOWN_M = 500;

const PIN_HALF_PX = 108;

export function proximityLevel(distanceM: number | null): ProximityLevel | null {
  if (distanceM === null || !Number.isFinite(distanceM)) return null;
  const d = Math.abs(distanceM);
  if (d < 5) return "close";
  if (d < 10) return "near";
  if (d < 17) return "far";
  return null;
}

/** `progressDiffLaps` = that car's laps completed + distance minus yours. */
export function lapLine(progressDiffLaps: number): LapLine | null {
  if (!Number.isFinite(progressDiffLaps)) return null;
  if (progressDiffLaps <= -0.5) return "lapping";
  if (progressDiffLaps >= 0.5) return "lapped";
  return null;
}

/** Steering dot position; steer is -1..1 of full lock, positive to the right. */
export function pinPx(steer: number | null): number {
  if (steer === null || !Number.isFinite(steer)) return PIN_HALF_PX;
  return Math.round(PIN_HALF_PX + Math.max(-1, Math.min(1, steer)) * PIN_HALF_PX);
}

const finite = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;
const round = (v: number, step: number): number => Math.round(v / step) * step;

const INACTIVE: CompactHudView = {
  active: false,
  speedMps: null,
  gear: null,
  rpm: null,
  lights: { lit: 0, shift: false, blink: false },
  throttle: 0,
  brake: 0,
  abs: false,
  limiter: false,
  pinPx: PIN_HALF_PX,
  ahead: null,
  behind: null,
  proximityAhead: null,
  proximityBehind: null,
  status: null,
};

/** A race scene: 168 km/h in 4th, partial lights, both gap tabs, a car 8 m ahead. */
export const EDIT_SAMPLE: CompactHudView = {
  active: true,
  speedMps: 46.7,
  gear: 4,
  rpm: 6620,
  lights: { lit: 4, shift: false, blink: false },
  throttle: 0.92,
  brake: 0,
  abs: false,
  limiter: false,
  pinPx: 89,
  ahead: { gapS: 1.2, lapLine: null },
  behind: { gapS: 0.8, lapLine: "lapping" },
  proximityAhead: "near",
  proximityBehind: null,
  status: null,
};

const LONE_QUALIFY = /^lone qualify$/i;

export function compactHudView(frame: TelemetryFrame | null, options: HudOptions): CompactHudView {
  if (frame === null || frame.status !== "live") return INACTIVE;
  const { state, derived } = frame;
  const { player, session } = state;
  if (player.isOnTrack !== true) return INACTIVE;

  const me =
    state.playerCarIdx === null
      ? undefined
      : state.cars.find((c) => c.carIdx === state.playerCarIdx);
  const loneQualify = session.typeName !== null && LONE_QUALIFY.test(session.typeName);
  const trackLengthM = finite(session.trackLengthM);
  const progress = (car: { lapsCompleted: number | null; lapDistPct: number | null }) =>
    finite(car.lapsCompleted) !== null && finite(car.lapDistPct) !== null
      ? (car.lapsCompleted as number) + (car.lapDistPct as number)
      : null;
  const myProgress = me === undefined ? null : progress(me);

  // Gap tabs: the nearest car ahead and behind by relative gap.
  let ahead: HudGap | null = null;
  let behind: HudGap | null = null;
  if (options.showGapTabs && !loneQualify) {
    let aheadS = -Infinity;
    let behindS = Infinity;
    let aheadIdx = -1;
    let behindIdx = -1;
    for (const g of derived.gaps) {
      const gap = finite(g.gapS);
      if (gap === null || gap === 0) continue;
      const car = state.cars.find((c) => c.carIdx === g.carIdx);
      if (car === undefined || car.onPitRoad === true || car.isOnTrack === false) continue;
      if (gap < 0 && gap > aheadS) {
        aheadS = gap;
        aheadIdx = g.carIdx;
      } else if (gap > 0 && gap < behindS) {
        behindS = gap;
        behindIdx = g.carIdx;
      }
    }
    const tab = (gapS: number, carIdx: number): HudGap => {
      const car = state.cars.find((c) => c.carIdx === carIdx);
      const theirs = car === undefined ? null : progress(car);
      return {
        gapS: round(Math.abs(gapS), 0.1),
        lapLine: myProgress === null || theirs === null ? null : lapLine(theirs - myProgress),
      };
    };
    if (aheadIdx >= 0 && -aheadS < options.gapRangeS) ahead = tab(aheadS, aheadIdx);
    if (behindIdx >= 0 && behindS < options.gapRangeS) behind = tab(behindS, behindIdx);
  }

  // Proximity lines: the nearest car in front and behind, from the cars within 20 m.
  let proximityAhead: ProximityLevel | null = null;
  let proximityBehind: ProximityLevel | null = null;
  if (options.showProximity && !loneQualify && derived.proximity !== null) {
    let bestAhead = Infinity;
    let bestBehind = Infinity;
    for (const c of derived.proximity.nearby) {
      if (c.longitudinalM > 0 && c.longitudinalM < bestAhead) bestAhead = c.longitudinalM;
      else if (c.longitudinalM < 0 && -c.longitudinalM < bestBehind) bestBehind = -c.longitudinalM;
    }
    proximityAhead = proximityLevel(Number.isFinite(bestAhead) ? bestAhead : null);
    proximityBehind = proximityLevel(Number.isFinite(bestBehind) ? bestBehind : null);
  }

  // Status pill: a slow car first, then the pit box.
  let status: HudStatus | null = null;
  const slow = derived.slowCar;
  if (options.showSlowCar && slow !== null && slow.distanceM <= options.slowCarRangeM) {
    status = { kind: "slow", distanceM: Math.round(slow.distanceM) };
  } else if (options.showPitCountdown) {
    const onPit =
      player.trackSurface === "approachingPits" ||
      player.trackSurface === "inPitStall" ||
      me?.onPitRoad === true;
    const stall = finite(player.pitStallLapDistPct);
    const here = finite(me?.lapDistPct);
    if (onPit && stall !== null && here !== null && trackLengthM !== null) {
      const distanceM = ((stall - here + 1) % 1) * trackLengthM;
      if (distanceM <= PIT_COUNTDOWN_M) {
        status = {
          kind: "pit",
          distanceM: Math.round(distanceM),
          fill: round(clamp01(1 - distanceM / PIT_COUNTDOWN_M), 0.01),
        };
      }
    }
  }

  const rpm = finite(player.rpm);
  const speed = finite(player.speedMps);
  return {
    active: true,
    speedMps: speed === null ? null : round(speed, 0.1),
    gear: finite(player.gear),
    rpm: rpm === null ? null : Math.round(rpm),
    lights: shiftLightState(rpm, shiftLightPoints(HUD_LIGHT_STEPS, player, options.shiftSource)),
    throttle: round(clamp01(player.inputs.throttle), 0.01),
    brake: round(clamp01(player.inputs.brake), 0.01),
    abs: player.absActive === true,
    limiter: player.pitLimiter === true,
    pinPx: pinPx(player.inputs.steer),
    ahead,
    behind,
    proximityAhead,
    proximityBehind,
    status,
  };
}
