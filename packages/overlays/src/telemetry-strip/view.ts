import type { Player, TelemetryFrame } from "@overlay/sim-core/types";
import {
  clamp01,
  lightColour,
  shiftLightPoints,
  shiftLightState,
  type LightColour,
  type ShiftLightSource,
} from "../shared/driving";

/** Number of shift-light LEDs on the strip. */
export const STRIP_LEDS = 16;

export type LedState = LightColour | "shift" | null;

export interface StripView {
  active: boolean;
  gear: number | null;
  speedMps: number | null;
  rpm: number | null;
  /** 16 entries: null = off, else the band colour or "shift". */
  leds: LedState[];
  blink: boolean;
  throttle: number; // 0..1
  brake: number; // 0..1
  position: number | null;
  /** startPosition - position; null when unknown or not a race. */
  placesGained: number | null;
  fuelFraction: number | null;
  lastLapS: number | null;
  trackTempC: number | null;
}

const finite = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

const NO_LEDS: LedState[] = Array.from({ length: STRIP_LEDS }, () => null);

const INACTIVE: StripView = {
  active: false,
  gear: null,
  speedMps: null,
  rpm: null,
  leds: NO_LEDS,
  blink: false,
  throttle: 0,
  brake: 0,
  position: null,
  placesGained: null,
  fuelFraction: null,
  lastLapS: null,
  trackTempC: null,
};

/** The LEDs for an rpm: lit ones in their band colour, all "shift" from the shift point. */
export function ledStates(
  rpm: number | null,
  player: Pick<Player, "shiftLights" | "redlineRpm">,
  source: ShiftLightSource,
): { leds: LedState[]; blink: boolean } {
  const points = shiftLightPoints(STRIP_LEDS, player, source);
  const state = shiftLightState(rpm, points);
  const leds = Array.from({ length: STRIP_LEDS }, (_, i): LedState => {
    if (state.shift) return "shift";
    return i < state.lit ? lightColour(i, STRIP_LEDS) : null;
  });
  return { leds, blink: state.blink };
}

export function stripView(
  frame: TelemetryFrame | null,
  livePositions: boolean,
  source: ShiftLightSource,
): StripView {
  if (frame === null || frame.status !== "live") return INACTIVE;
  const { state, derived } = frame;
  const { player, session, conditions } = state;
  if (player.isOnTrack !== true) return INACTIVE;

  const rpm = finite(player.rpm);
  const { leds, blink } = ledStates(rpm, player, source);

  const entry =
    state.playerCarIdx === null
      ? undefined
      : derived.standings?.entries.find((e) => e.carIdx === state.playerCarIdx);
  const position = finite(livePositions ? entry?.livePosition : entry?.position);
  const start = finite(entry?.startPosition);
  const placesGained =
    session.type === "race" && position !== null && start !== null ? start - position : null;

  const fuel = finite(player.fuelL);
  const capacity = finite(player.fuelCapacityL);
  return {
    active: true,
    gear: finite(player.gear),
    speedMps: finite(player.speedMps),
    rpm,
    leds,
    blink,
    throttle: clamp01(player.inputs.throttle),
    brake: clamp01(player.inputs.brake),
    position,
    placesGained,
    fuelFraction:
      fuel !== null && capacity !== null && capacity > 0 ? clamp01(fuel / capacity) : null,
    lastLapS: finite(player.lap?.lastLapS),
    trackTempC: finite(conditions.trackTempC),
  };
}

/** Gear 6, 157 km/h, 7590 rpm, P14 (+6 places), 78 % fuel, 1:51.000, 43 °C, 10 lights; shown while editing. */
export const EDIT_SAMPLE: StripView = {
  active: true,
  gear: 6,
  speedMps: 157 / 3.6,
  rpm: 7590,
  leds: Array.from({ length: STRIP_LEDS }, (_, i): LedState =>
    i < 10 ? lightColour(i, STRIP_LEDS) : null,
  ),
  blink: false,
  throttle: 1,
  brake: 0.21,
  position: 14,
  placesGained: 6,
  fuelFraction: 0.78,
  lastLapS: 111,
  trackTempC: 43,
};
