import type { DisplayPrefs } from "@overlay/ui/types";

export interface AppSettings {
  general: DisplayPrefs & {
    startWithWindows: boolean;
    /** Hide overlays while no sim is connected (an overlay's "Always show" overrides it). */
    autoHide: boolean;
    /** Settings window zoom, applied with CSS zoom (never webContents.setZoomFactor: zoom is per origin). */
    uiScalePct: 100 | 110 | 125 | 150;
    /** When Windows starts the app at login (`--hidden`), stay in the tray with no window. */
    startHiddenAtLogin: boolean;
    /** What the main window's close button does: hide to the tray, or quit the app. */
    closeAction: "tray" | "quit";
    /** Minimise the main window when a sim connects. */
    minimiseOnConnect: boolean;
    /** The Overlays page welcome card was dismissed. */
    welcomeDismissed: boolean;
  };
  /** Small one-off UI flags. */
  ui: {
    /** The "still running in the tray" notice has been shown once. */
    trayNoticeShown: boolean;
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
    startHiddenAtLogin: true,
    closeAction: "tray",
    minimiseOnConnect: false,
    welcomeDismissed: false,
  },
  ui: { trayNoticeShown: false },
  performance: { telemetryRateHz: 60, livePositions: true, reduceVisualEffects: false },
  appearance: { combinedLicencePill: false },
  developer: { enabled: false },
};

export function displayPrefsOf(settings: AppSettings): DisplayPrefs {
  const { units, speedInMph, timeFormat } = settings.general;
  return { units, speedInMph, timeFormat };
}
