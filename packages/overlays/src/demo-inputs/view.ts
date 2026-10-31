import type { TelemetryFrame } from "@overlay/sim-core/types";
import type { DisplayPrefs } from "@overlay/ui/types";

export interface InputsView {
  /** 0..1, except steer (-1..1). */
  throttle: number;
  brake: number;
  clutch: number;
  steer: number;
  /** -1 reverse, 0 neutral, 1..n. */
  gear: number;
  /** m/s, as the sim reports it. */
  speedMps: number;
}

const ZERO_INPUTS: InputsView = {
  throttle: 0,
  brake: 0,
  clutch: 0,
  steer: 0,
  gear: 0,
  speedMps: 0,
};

const clamp = (v: number | null, lo: number, hi: number): number =>
  v === null || !Number.isFinite(v) ? 0 : Math.min(hi, Math.max(lo, v));

/** Player inputs; all zero unless the frame is live. */
export function inputsView(frame: TelemetryFrame | null): InputsView {
  if (frame === null || frame.status !== "live") return ZERO_INPUTS;
  const { inputs, gear, speedMps } = frame.state.player;
  return {
    throttle: clamp(inputs.throttle, 0, 1),
    brake: clamp(inputs.brake, 0, 1),
    clutch: clamp(inputs.clutch, 0, 1),
    steer: clamp(inputs.steer, -1, 1),
    gear: Math.round(clamp(gear, -1, 20)),
    speedMps: clamp(speedMps, 0, 200),
  };
}

export function formatGear(gear: number): string {
  return gear < 0 ? "R" : gear === 0 ? "N" : String(gear);
}

const KPH_PER_MPS = 3.6;
const MPH_PER_MPS = 2.2369362920544;

/**
 * Speed with its unit for the user's preferences. This local helper stands in for the shared
 * speed formatter in @overlay/ui/format, which lands in parallel; switch to it once it exists.
 */
export function formatSpeed(speedMps: number, prefs: DisplayPrefs): string {
  const mph = prefs.units === "imperial" || prefs.speedInMph;
  return mph
    ? `${Math.round(speedMps * MPH_PER_MPS)} mph`
    : `${Math.round(speedMps * KPH_PER_MPS)} km/h`;
}
