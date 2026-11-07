import type { TelemetryFrame } from "@overlay/sim-core/types";
import { clamp01 } from "../shared/driving";

export interface InputsView {
  /** A live frame: the trace records only then. */
  active: boolean;
  throttle: number; // 0..1
  brake: number;
  clutch: number;
  /** -1..1, positive right. */
  steer: number;
  abs: boolean;
  /** Wheel angle in degrees, clockwise = right. */
  wheelDeg: number;
  gear: number | null;
  speedMps: number | null;
  /** Sim session time of this frame; null when unknown. */
  tickTimeS: number | null;
}

/** Without a known lock, the wheel is assumed to turn 180 degrees each side. */
const DEFAULT_LOCK_RAD = Math.PI;

const IDLE: InputsView = {
  active: false,
  throttle: 0,
  brake: 0,
  clutch: 0,
  steer: 0,
  abs: false,
  wheelDeg: 0,
  gear: null,
  speedMps: null,
  tickTimeS: null,
};

function clampSteer(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/** Wheel angle in degrees: steer x lock (steerMaxRad, else 180 degrees each side). */
export function wheelAngleDeg(steer: number, steerMaxRad: number | null): number {
  const lock =
    steerMaxRad !== null && Number.isFinite(steerMaxRad) && steerMaxRad > 0
      ? steerMaxRad
      : DEFAULT_LOCK_RAD;
  return (steer * lock * 180) / Math.PI;
}

/** Player inputs; idle unless the frame is live. */
export function inputsView(frame: TelemetryFrame | null): InputsView {
  if (frame === null || frame.status !== "live") return IDLE;
  const { player, tickTimeS } = frame.state;
  const steer = clampSteer(player.inputs.steer);
  return {
    active: true,
    throttle: clamp01(player.inputs.throttle),
    brake: clamp01(player.inputs.brake),
    clutch: clamp01(player.inputs.clutch),
    steer,
    abs: player.absActive === true,
    wheelDeg: wheelAngleDeg(steer, player.steerMaxRad),
    gear: player.gear,
    speedMps: player.speedMps,
    tickTimeS: tickTimeS !== null && Number.isFinite(tickTimeS) ? tickTimeS : null,
  };
}

/** Bar value above the well, 0..100. */
export function barValue(fraction: number): number {
  return Math.round(clamp01(fraction) * 100);
}
