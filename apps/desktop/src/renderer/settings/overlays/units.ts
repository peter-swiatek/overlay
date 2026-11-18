import type { SettingUnit } from "@overlay/overlays/contract";
import type { DisplayPrefs } from "@overlay/ui/types";

// Same factors as packages/ui's formatters. packages/ui only formats, so the inverse lives here;
// a candidate to move into packages/ui later.
const FEET_PER_METRE = 1 / 0.3048;
const MPH_PER_KMH = 0.621371;

/** Stored unit -> shown unit multiplier. */
export function displayFactor(unit: SettingUnit | undefined, prefs: DisplayPrefs): number {
  if (unit === "m") return prefs.units === "imperial" ? FEET_PER_METRE : 1;
  if (unit === "km/h") return prefs.units === "imperial" || prefs.speedInMph ? MPH_PER_KMH : 1;
  return 1;
}

/** The unit label to show next to the value. */
export function displayUnitLabel(unit: SettingUnit | undefined, prefs: DisplayPrefs): string {
  if (unit === undefined) return "";
  if (unit === "m") return prefs.units === "imperial" ? "ft" : "m";
  if (unit === "km/h") return prefs.units === "imperial" || prefs.speedInMph ? "mph" : "km/h";
  return unit;
}

/** Whole numbers when one stored step is at least 1 shown unit, otherwise one decimal. */
export function displayDecimals(
  unit: SettingUnit | undefined,
  step: number,
  prefs: DisplayPrefs,
): 0 | 1 {
  return step * displayFactor(unit, prefs) >= 1 ? 0 : 1;
}

export function roundTo(value: number, decimals: 0 | 1): number {
  const k = decimals === 0 ? 1 : 10;
  return Math.round(value * k) / k;
}
