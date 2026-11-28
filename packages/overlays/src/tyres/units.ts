// Unit formatting shared by the Tyres and Car Status overlays.
import type { DisplayPrefs } from "@overlay/ui/types";

export const NO_VALUE = "--";
const KPA_PER_PSI = 6.894757;
const KPA_PER_BAR = 100;

export type PressureUnit = "kpa" | "bar" | "psi";

/** "auto" follows Settings > General > Units: kPa when metric, psi when imperial. */
export function pressureUnit(option: string, prefs: DisplayPrefs): PressureUnit {
  if (option === "kpa" || option === "bar" || option === "psi") return option;
  return prefs.units === "imperial" ? "psi" : "kpa";
}

/** "172 kPa", "1.72 bar", "24.9 psi"; "-- kPa" when unknown. */
export function pressureText(kpa: number | null, unit: PressureUnit): string {
  if (kpa === null) return `${NO_VALUE} ${unit === "kpa" ? "kPa" : unit}`;
  if (unit === "bar") return `${(kpa / KPA_PER_BAR).toFixed(2)} bar`;
  if (unit === "psi") return `${(kpa / KPA_PER_PSI).toFixed(1)} psi`;
  return `${Math.round(kpa)} kPa`;
}

/** Whole degrees, Fahrenheit with imperial units: "91°"; "--" when unknown. */
export function degreesText(celsius: number | null, prefs: DisplayPrefs): string {
  if (celsius === null) return NO_VALUE;
  const value = prefs.units === "imperial" ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(value)}°`;
}
