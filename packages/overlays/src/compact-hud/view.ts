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
/** The slow-car pill; never shown on pit road. */
export interface HudStatus {
  kind: "slow";
  distanceM: number;
}

/** The pit guide above the HUD: the pit box or, near the end of pit road, the pit exit. */
export interface PitGuide {
  /** Null off pit road, when the option is off, or when there is nothing to guide to. */
  kind: "box" | "exit" | null;
  /** Metres to the box / exit line, whole; 0 when `kind` is null. */
  distanceM: number;
  /** Top edge of the car marker in px inside the 112 px strip: 20 at 0 m .. 102 at 150 m or more. */
  markerY: number;
}

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
  pitGuide: PitGuide;
}

export interface HudOptions {
  gapRangeS: number;
  showGapTabs: boolean;
  showProximity: boolean;
  showPitGuide: boolean;
  showSlowCar: boolean;
  slowCarRangeM: number;
  shiftSource: ShiftLightSource;
}

/** Shift-light steps (pairs) in the HUD. */
export const HUD_LIGHT_STEPS = 6;
/** The pit guide shows the box when the stall is at most this far ahead, metres. */
export const PIT_GUIDE_BOX_M = 500;
/** The pit guide switches to the exit when the exit line is closer than this, metres. */
export const PIT_GUIDE_EXIT_M = 100;
/** The car marker stops climbing below this distance, metres. */
export const PIT_MARKER_FULL_M = 150;
/** Marker top edge at the stop line (0 m) and the travel down to 150 m, px. */
const MARKER_TOP_PX = 20;
const MARKER_TRAVEL_PX = 82;

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

/** Top edge of the car marker for a distance to the line, px (one decimal). */
export function pitMarkerY(distanceM: number): number {
  const d = Math.min(Math.max(distanceM, 0), PIT_MARKER_FULL_M);
  return Math.round((MARKER_TOP_PX + (d / PIT_MARKER_FULL_M) * MARKER_TRAVEL_PX) * 10) / 10;
}

const NO_PIT_GUIDE: PitGuide = { kind: null, distanceM: 0, markerY: MARKER_TOP_PX };

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
  pitGuide: NO_PIT_GUIDE,
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
  pitGuide: NO_PIT_GUIDE,
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

  // Proximity lines: the nearest car in front and behind, from the nearby cars (shown below 17 m).
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

  // On pit road the pit guide takes over from the slow-car pill.
  const onPit =
    player.trackSurface === "approachingPits" ||
    player.trackSurface === "inPitStall" ||
    me?.onPitRoad === true;
  let status: HudStatus | null = null;
  let pitGuide = NO_PIT_GUIDE;
  const slow = derived.slowCar;
  if (!onPit) {
    if (options.showSlowCar && slow !== null && slow.distanceM <= options.slowCarRangeM) {
      status = { kind: "slow", distanceM: Math.round(slow.distanceM) };
    }
  } else if (options.showPitGuide) {
    const exitM = finite(derived.track.pitExitDistanceM);
    const stall = finite(player.pitStallLapDistPct);
    const here = finite(me?.lapDistPct);
    const boxM =
      player.trackSurface === "inPitStall"
        ? 0
        : stall !== null && here !== null && trackLengthM !== null
          ? ((stall - here + 1) % 1) * trackLengthM
          : null;
    const guide = (kind: "box" | "exit", metres: number): PitGuide => ({
      kind,
      distanceM: Math.round(metres),
      markerY: pitMarkerY(Math.round(metres)),
    });
    if (exitM !== null && exitM < PIT_GUIDE_EXIT_M) pitGuide = guide("exit", exitM);
    else if (boxM !== null && boxM <= PIT_GUIDE_BOX_M) pitGuide = guide("box", boxM);
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
    pitGuide,
  };
}
