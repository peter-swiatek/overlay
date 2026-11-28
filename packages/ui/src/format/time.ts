import type { Decimals, DisplayPrefs } from "../types";

const pow10 = (d: Decimals): number => 10 ** d;

/** Rounds to `decimals` places and fixes "-0" so a rounded-to-zero value never prints a sign. */
export function toFixedClean(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

export function formatLapTime(seconds: number | null, decimals: Decimals = 3): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "--";
  // Round first so 59.9996 s at 3 decimals carries into the minute ("1:00.000").
  const perSecond = pow10(decimals);
  const units = Math.round(seconds * perSecond);
  const whole = Math.floor(units / perSecond);
  const frac = units - whole * perSecond;
  const fracText = decimals > 0 ? `.${String(frac).padStart(decimals, "0")}` : "";
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  if (minutes === 0) return `${secs}${fracText}`;
  return `${minutes}:${String(secs).padStart(2, "0")}${fracText}`;
}

export function formatDelta(seconds: number | null, decimals: Decimals = 1): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--";
  const text = toFixedClean(seconds, decimals);
  if (/^0(\.0+)?$/.test(text)) return text;
  return seconds > 0 ? `+${text}` : text;
}

export function formatGap(
  gap: { laps: number; seconds: number | null } | null,
  decimals: Decimals = 1,
): string {
  if (gap === null) return "--";
  if (gap.laps >= 1) return `+${gap.laps} L`;
  // A gap of exactly zero is the leader (or the car itself).
  if (gap.seconds === null || !Number.isFinite(gap.seconds) || gap.seconds === 0) return "--";
  return `+${toFixedClean(Math.max(0, gap.seconds), decimals)}`;
}

/** "1:37:27", "12:06", "0:45". Whole seconds, rounded down. */
export function formatSessionTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--";
  const total = Math.floor(Math.max(0, seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function clock(hours: number, minutes: number, prefs: DisplayPrefs): string {
  const mm = String(minutes).padStart(2, "0");
  if (prefs.timeFormat === "24h") return `${String(hours).padStart(2, "0")}:${mm}`;
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${mm} ${hours < 12 ? "AM" : "PM"}`;
}

/** Local wall-clock time. */
export function formatClockTime(date: Date, prefs: DisplayPrefs): string {
  return clock(date.getHours(), date.getMinutes(), prefs);
}

/** Sim time of day; wraps around midnight. */
export function formatTimeOfDay(secondsAfterMidnight: number | null, prefs: DisplayPrefs): string {
  if (secondsAfterMidnight === null || !Number.isFinite(secondsAfterMidnight)) return "--";
  const total = Math.floor(((secondsAfterMidnight % 86400) + 86400) % 86400);
  return clock(Math.floor(total / 3600), Math.floor((total % 3600) / 60), prefs);
}
