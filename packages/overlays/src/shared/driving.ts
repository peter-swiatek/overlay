import type { Player } from "@overlay/sim-core/types";

/** -1 "R", 0 "N", n "n"; null "-". */
export function formatGear(gear: number | null): string {
  if (gear === null || !Number.isFinite(gear)) return "-";
  if (gear < 0) return "R";
  if (gear === 0) return "N";
  return String(Math.round(gear));
}

/** Clamped to 0..1; null, undefined and non-finite give 0. */
export function clamp01(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export type ShiftLightSource = "car" | "custom";
export type LightColour = "green" | "yellow" | "red";

export interface ShiftLightPoints {
  /** rpm at which step i lights (i = 0 is the first light); ascending. */
  thresholds: number[];
  /** Every light in the shift colour from here. */
  shiftRpm: number;
  /** Lights and gear blink from here; null = never. */
  blinkRpm: number | null;
}

const CUSTOM_FRACTIONS_6 = [0.75, 0.78, 0.8, 0.82, 0.85, 0.9];
const CUSTOM_FIRST = 0.75;
const CUSTOM_LAST = 0.9;
const CUSTOM_SHIFT = 0.95;
const CUSTOM_BLINK = 0.98;

/**
 * Where the lights come on. "car" uses the car's own points, thresholds spaced evenly from first
 * to last; "car" without shift-light data falls back to "custom" (a share of the redline). Null
 * without a redline for the custom case.
 */
export function shiftLightPoints(
  steps: number,
  car: Pick<Player, "shiftLights" | "redlineRpm">,
  source: ShiftLightSource,
): ShiftLightPoints | null {
  if (!Number.isInteger(steps) || steps < 1) return null;
  const redline = car.redlineRpm !== null && car.redlineRpm > 0 ? car.redlineRpm : null;
  const sli = car.shiftLights;
  if (source === "car" && sli) {
    const thresholds = Array.from({ length: steps }, (_, i) =>
      steps === 1 ? sli.firstRpm : sli.firstRpm + ((sli.lastRpm - sli.firstRpm) * i) / (steps - 1),
    );
    return {
      thresholds,
      shiftRpm: sli.shiftRpm,
      blinkRpm: sli.blinkRpm ?? (redline !== null ? CUSTOM_BLINK * redline : null),
    };
  }
  if (redline === null) return null;
  const thresholds = Array.from({ length: steps }, (_, i) => {
    const fraction =
      steps === 6
        ? (CUSTOM_FRACTIONS_6[i] as number)
        : steps === 1
          ? CUSTOM_FIRST
          : CUSTOM_FIRST + ((CUSTOM_LAST - CUSTOM_FIRST) * i) / (steps - 1);
    return fraction * redline;
  });
  return { thresholds, shiftRpm: CUSTOM_SHIFT * redline, blinkRpm: CUSTOM_BLINK * redline };
}

export interface ShiftLightState {
  /** Steps lit, 0..steps. */
  lit: number;
  /** At or above the shift point: every light in the shift colour. */
  shift: boolean;
  /** At or above the blink point. */
  blink: boolean;
}

export function shiftLightState(
  rpm: number | null,
  points: ShiftLightPoints | null,
): ShiftLightState {
  if (rpm === null || !Number.isFinite(rpm) || points === null) {
    return { lit: 0, shift: false, blink: false };
  }
  return {
    lit: points.thresholds.filter((t) => rpm >= t).length,
    shift: rpm >= points.shiftRpm,
    blink: points.blinkRpm !== null && rpm >= points.blinkRpm,
  };
}

/** Colour band of step i of `steps` (first 37.5 % green, next 25 % yellow, rest red; rounded). */
export function lightColour(step: number, steps: number): LightColour {
  const green = Math.round(steps * 0.375);
  const yellow = Math.round(steps * 0.625);
  if (step < green) return "green";
  if (step < yellow) return "yellow";
  return "red";
}

/** CSS colour per band, and "shift". */
export const LIGHT_COLOUR_VAR: Readonly<Record<LightColour | "shift", string>> = {
  green: "var(--ov-locked-gain)",
  yellow: "var(--ov-locked-flag-yellow)",
  red: "var(--ov-locked-loss)",
  shift: "var(--ov-locked-shift)",
};
