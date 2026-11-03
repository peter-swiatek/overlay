import { formatLapTime, formatSpeed, toFixedClean } from "@overlay/ui/format";
import type { DisplayPrefs } from "@overlay/ui/types";

const NO_LAP = "--:--.---";

/** Signed, 2 decimals ("+0.42", "-0.31", "0.00"); |s| >= 10 -> "+9.99" / "-9.99"; null -> "--". */
export function formatLapDelta(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "--";
  if (Math.abs(s) >= 10) return s > 0 ? "+9.99" : "-9.99";
  const text = toFixedClean(s, 2);
  // 9.996 rounds to "10.00": keep the cap.
  if (text === "10.00") return "+9.99";
  if (text === "-10.00") return "-9.99";
  if (/^0(\.0+)?$/.test(text)) return text;
  return s > 0 ? `+${text}` : text;
}

/** Lap time for the strip and best times; invalid or null -> "--:--.---". */
export function formatStripLapTime(s: number | null): string {
  if (s === null || !Number.isFinite(s) || s <= 0) return NO_LAP;
  return formatLapTime(s, 3);
}

/** Speed delta in the user's unit, whole numbers, signed ("+4"); 0 -> "0"; null -> "--". */
export function formatSpeedDelta(
  mps: number | null,
  prefs: DisplayPrefs,
): { value: string; unit: string } {
  const m = formatSpeed(mps, prefs, 0);
  if (m.value === "--" || m.value === "0" || m.value.startsWith("-")) return m;
  return { value: `+${m.value}`, unit: m.unit };
}
