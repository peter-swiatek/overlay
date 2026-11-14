import type { Decimals, DisplayPrefs } from "../types";
import { toFixedClean } from "./time";

export interface Measure {
  value: string;
  unit: string;
}

const MPS_PER_MPH = 0.44704;
const LITRES_PER_GAL = 3.785411784;
const METRES_PER_FT = 0.3048;
const KPA_PER_PSI = 6.894757;

function measure(value: number | null, decimals: Decimals, unit: string): Measure {
  if (value === null || !Number.isFinite(value)) return { value: "--", unit };
  return { value: toFixedClean(value, decimals), unit };
}

export function formatSpeed(
  mps: number | null,
  prefs: DisplayPrefs,
  decimals: Decimals = 0,
): Measure {
  const mph = prefs.units === "imperial" || prefs.speedInMph;
  if (mph) return measure(mps === null ? null : mps / MPS_PER_MPH, decimals, "mph");
  return measure(mps === null ? null : mps * 3.6, decimals, "km/h");
}

export function formatVolume(
  litres: number | null,
  prefs: DisplayPrefs,
  decimals: Decimals = 1,
): Measure {
  if (prefs.units === "imperial") {
    return measure(litres === null ? null : litres / LITRES_PER_GAL, decimals, "gal");
  }
  return measure(litres, decimals, "L");
}

export function formatTemperature(
  celsius: number | null,
  prefs: DisplayPrefs,
  decimals: Decimals = 1,
): Measure {
  if (prefs.units === "imperial") {
    return measure(celsius === null ? null : (celsius * 9) / 5 + 32, decimals, "°F");
  }
  return measure(celsius, decimals, "°C");
}

export function formatDistance(
  metres: number | null,
  prefs: DisplayPrefs,
  decimals: Decimals = 0,
): Measure {
  if (prefs.units === "imperial") {
    return measure(metres === null ? null : metres / METRES_PER_FT, decimals, "ft");
  }
  return measure(metres, decimals, "m");
}

export function formatPressure(
  kpa: number | null,
  prefs: DisplayPrefs,
  decimals: Decimals = 1,
): Measure {
  if (prefs.units === "imperial") {
    return measure(kpa === null ? null : kpa / KPA_PER_PSI, decimals, "psi");
  }
  return measure(kpa, decimals, "kPa");
}

export function formatPercent(fraction: number | null, decimals: Decimals = 0): string {
  if (fraction === null || !Number.isFinite(fraction)) return "--";
  return `${toFixedClean(fraction * 100, decimals)}%`;
}
