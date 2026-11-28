import type { TelemetryFrame } from "@overlay/sim-core/types";

export type Wetness = "dry" | "damp" | "wet";

export interface WeatherView {
  live: boolean;
  /** Dial rotation, degrees: -heading. Null without a heading. */
  dialDeg: number | null;
  /** Wind arrow, degrees clockwise from the car's nose: where the wind blows to. Null without heading or wind direction. */
  arrowDeg: number | null;
  /** 8-point compass name of where the wind comes from. */
  windFrom: string | null;
  windSpeedMps: number | null;
  trackTempC: number | null;
  airTempC: number | null;
  humidity: number | null; // 0..1
  precipitation: number | null; // 0..1
  /** SessionInfo.trackUsage without a trailing " usage", first letter upper case ("Moderate"). */
  usage: string | null;
  wetness: number | null; // 0..1
  wetnessLabel: Wetness | null;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const DEG_PER_RAD = 180 / Math.PI;

const finite = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

/** Degrees into 0..360 (never -0). */
const norm360 = (deg: number): number => (((deg % 360) + 360) % 360) + 0;

/** Dry below 0.05, Damp below 0.5, Wet from 0.5; null stays null. */
export function wetnessLabel(wetness: number | null): Wetness | null {
  if (wetness === null || !Number.isFinite(wetness)) return null;
  if (wetness < 0.05) return "dry";
  if (wetness < 0.5) return "damp";
  return "wet";
}

/** 8-point compass name of a bearing in degrees. */
export function compassName(deg: number): string {
  return COMPASS[Math.round(norm360(deg) / 45) % 8]!;
}

function usageText(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw
    .trim()
    .replace(/\s+usage$/i, "")
    .trim();
  if (t === "") return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const EMPTY: WeatherView = {
  live: false,
  dialDeg: null,
  arrowDeg: null,
  windFrom: null,
  windSpeedMps: null,
  trackTempC: null,
  airTempC: null,
  humidity: null,
  precipitation: null,
  usage: null,
  wetness: null,
  wetnessLabel: null,
};

/** Shown in edit mode without live data: dry, 28 / 22 degrees C, 12 km/h wind from the east, heading west. */
export const EDIT_SAMPLE: WeatherView = {
  live: true,
  dialDeg: 90,
  arrowDeg: 0,
  windFrom: "E",
  windSpeedMps: 12 / 3.6,
  trackTempC: 28,
  airTempC: 22,
  humidity: 0.55,
  precipitation: 0,
  usage: "Moderate",
  wetness: 0,
  wetnessLabel: "dry",
};

export function weatherView(frame: TelemetryFrame | null): WeatherView {
  if (frame === null || frame.status !== "live") return EMPTY;
  const { player, session, conditions: c } = frame.state;
  const heading = finite(player.yawRad);
  const windFrom = finite(c.windDirRad);
  const headingDeg = heading === null ? null : heading * DEG_PER_RAD;
  const windFromDeg = windFrom === null ? null : norm360(windFrom * DEG_PER_RAD);
  const wetness = finite(c.wetness);
  return {
    live: true,
    dialDeg: headingDeg === null ? null : norm360(-headingDeg),
    arrowDeg:
      headingDeg === null || windFromDeg === null ? null : norm360(windFromDeg + 180 - headingDeg),
    windFrom: windFromDeg === null ? null : compassName(windFromDeg),
    windSpeedMps: finite(c.windSpeedMps),
    trackTempC: finite(c.trackTempC),
    airTempC: finite(c.airTempC),
    humidity: finite(c.humidity),
    precipitation: finite(c.precipitation),
    usage: usageText(session.trackUsage),
    wetness,
    wetnessLabel: wetnessLabel(wetness),
  };
}
