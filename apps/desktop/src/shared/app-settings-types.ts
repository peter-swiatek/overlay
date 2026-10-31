import type { DisplayPrefs } from "@overlay/ui/types";

export interface AppSettings {
  general: DisplayPrefs & {
    startWithWindows: boolean;
    /** Hide overlays while no sim is connected (an overlay's "Always show" overrides it). */
    autoHide: boolean;
    /** Settings window zoom, applied with CSS zoom (never webContents.setZoomFactor: zoom is per origin). */
    uiScalePct: 100 | 110 | 125 | 150;
  };
  performance: {
    /** Cap on every overlay's telemetry rate. */
    telemetryRateHz: 30 | 60;
    /** Distance-based live positions (true) or official S/F positions (false). */
    livePositions: boolean;
    reduceVisualEffects: boolean;
  };
  appearance: {
    /** Tint the iRating pill with the licence colour. */
    combinedLicencePill: boolean;
  };
  developer: {
    /** Shows the Developer page, developer-only overlays, and the tray's Replay file and Mock sources. */
    enabled: boolean;
  };
}

export type AppSettingsPatch = { [K in keyof AppSettings]?: Partial<AppSettings[K]> };

export const DEFAULT_APP_SETTINGS: AppSettings = {
  general: {
    units: "metric",
    speedInMph: false,
    timeFormat: "24h",
    startWithWindows: false,
    autoHide: false,
    uiScalePct: 100,
  },
  performance: { telemetryRateHz: 60, livePositions: true, reduceVisualEffects: false },
  appearance: { combinedLicencePill: false },
  developer: { enabled: false },
};

export function displayPrefsOf(settings: AppSettings): DisplayPrefs {
  const { units, speedInMph, timeFormat } = settings.general;
  return { units, speedInMph, timeFormat };
}
