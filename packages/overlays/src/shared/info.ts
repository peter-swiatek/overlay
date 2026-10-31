import type { SettingOption } from "../contract";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import {
  formatClockTime,
  formatIRating,
  formatPercent,
  formatSessionTime,
  formatTemperature,
  formatTimeOfDay,
} from "@overlay/ui/format";
import type { DisplayPrefs } from "@overlay/ui/types";
import { focusCarIdx } from "./rows";
import type { SessionDisplay } from "./options";

export const HEADER_FIELD_IDS = [
  "sof",
  "incidents",
  "session-remaining",
  "sim-time",
  "real-time",
  "air-temp",
  "track-temp",
  "wetness",
  "precipitation",
  "humidity",
  "fog",
  "wind-direction",
  "current-lap",
  "brake-bias",
] as const;
export type HeaderFieldId = (typeof HEADER_FIELD_IDS)[number];

const LABELS: Record<HeaderFieldId, string> = {
  sof: "SoF",
  incidents: "Incidents",
  "session-remaining": "Laps/time remaining",
  "sim-time": "Sim time",
  "real-time": "Real time",
  "air-temp": "Air temp",
  "track-temp": "Track temp",
  wetness: "Track wetness",
  precipitation: "Precipitation",
  humidity: "Humidity",
  fog: "Fog level",
  "wind-direction": "Wind direction",
  "current-lap": "Current lap",
  "brake-bias": "Brake bias",
};

/** Items only iRacing reports; the option list greys them out elsewhere. */
const IRACING_ONLY: readonly HeaderFieldId[] = [
  "sof",
  "incidents",
  "precipitation",
  "humidity",
  "fog",
  "wind-direction",
];

/** SettingOption list for a "multi" header/footer field. */
export const HEADER_FIELD_OPTIONS: readonly SettingOption[] = HEADER_FIELD_IDS.map((id) =>
  IRACING_ONLY.includes(id)
    ? { value: id, label: LABELS[id], sims: ["iracing"] }
    : { value: id, label: LABELS[id] },
);

export interface InfoContext {
  prefs: DisplayPrefs;
  sessionDisplay: SessionDisplay;
  /** Show the incident DQ limit as "/ N" when the session has one. */
  showDqLimit: boolean;
  /** Wall clock for "real-time" (the selector passes new Date()). */
  now: Date;
}

export interface InfoItem {
  id: HeaderFieldId;
  label: string;
  value: string;
  unavailable: boolean;
}

const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

/** 16-point compass name for the direction the wind comes from. */
function compassPoint(rad: number | null): string | null {
  if (rad === null || !Number.isFinite(rad)) return null;
  const turns = (((rad / (2 * Math.PI)) % 1) + 1) % 1;
  return COMPASS[Math.round(turns * 16) % 16] ?? null;
}

function isHeaderFieldId(id: string): id is HeaderFieldId {
  return (HEADER_FIELD_IDS as readonly string[]).includes(id);
}

function remaining(frame: TelemetryFrame, display: SessionDisplay): string | null {
  const { session } = frame.state;
  const time = session.timeRemainingS === null ? null : formatSessionTime(session.timeRemainingS);
  const laps = session.lapsRemaining === null ? null : `${session.lapsRemaining} laps`;
  if (display === "time") return time;
  if (display === "laps") return laps;
  if (session.timing === "laps") return laps ?? time;
  return time ?? laps;
}

function currentLap(frame: TelemetryFrame): string | null {
  const { state } = frame;
  const idx = focusCarIdx(state);
  const lap = state.cars.find((c) => c.carIdx === idx)?.lapInProgress ?? null;
  if (lap === null) return null;
  const { timing, lapsTotal } = state.session;
  const limited = (timing === "laps" || timing === "laps-or-time") && lapsTotal !== null;
  return limited ? `${lap} / ${lapsTotal}` : String(lap);
}

function itemValue(id: HeaderFieldId, frame: TelemetryFrame, ctx: InfoContext): string | null {
  const { session, conditions, player } = frame.state;
  const measure = (m: { value: string; unit: string }): string => `${m.value} ${m.unit}`.trim();
  switch (id) {
    case "sof": {
      const sof = frame.derived.standings?.sof ?? null;
      return sof === null ? null : formatIRating(Math.round(sof));
    }
    case "incidents": {
      if (player.incidentCount === null) return null;
      return ctx.showDqLimit && session.incidentLimit !== null
        ? `${player.incidentCount} / ${session.incidentLimit}`
        : String(player.incidentCount);
    }
    case "session-remaining":
      return remaining(frame, ctx.sessionDisplay);
    case "sim-time":
      return session.timeOfDayS === null ? null : formatTimeOfDay(session.timeOfDayS, ctx.prefs);
    case "real-time":
      return formatClockTime(ctx.now, ctx.prefs);
    case "air-temp":
      return conditions.airTempC === null
        ? null
        : measure(formatTemperature(conditions.airTempC, ctx.prefs));
    case "track-temp":
      return conditions.trackTempC === null
        ? null
        : measure(formatTemperature(conditions.trackTempC, ctx.prefs));
    case "wetness":
      return conditions.wetness === null ? null : formatPercent(conditions.wetness);
    case "precipitation":
      return conditions.precipitation === null ? null : formatPercent(conditions.precipitation);
    case "humidity":
      return conditions.humidity === null ? null : formatPercent(conditions.humidity);
    case "fog":
      return conditions.fogLevel === null ? null : formatPercent(conditions.fogLevel);
    case "wind-direction":
      return compassPoint(conditions.windDirRad);
    case "current-lap":
      return currentLap(frame);
    case "brake-bias":
      return player.brakeBias === null ? null : formatPercent(player.brakeBias, 1);
  }
}

/** Header or footer items for the given ids (unknown ids skipped). A value the sim does not supply is "--" and unavailable. */
export function infoItems(
  frame: TelemetryFrame | null,
  ids: readonly string[],
  ctx: InfoContext,
): InfoItem[] {
  const items: InfoItem[] = [];
  for (const id of ids) {
    if (!isHeaderFieldId(id)) continue;
    const value = frame === null ? null : itemValue(id, frame, ctx);
    items.push({
      id,
      label: LABELS[id],
      value: value ?? "--",
      unavailable: value === null,
    });
  }
  return items;
}
