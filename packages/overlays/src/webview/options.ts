/**
 * The Webview overlay's options, read the same way by the overlay window and the main process
 * (which owns the embedded page). No React or CSS here: main imports this module.
 */
import type { OverlayInstanceSettings, SettingOption } from "../contract";
import { parseWebPageUrl } from "../shared/web-url";

/** The manifest id; main embeds a page only for windows of this overlay. */
export const WEBVIEW_OVERLAY_ID = "webview";

export const WEBVIEW_KEYS = {
  url: "url",
  transparent: "transparent-background",
  hideScrollbars: "hide-scrollbars",
  zoom: "page-zoom",
  refresh: "auto-refresh",
  interactive: "allow-interaction",
  customCss: "custom-css",
} as const;

/** Longest custom CSS accepted, in characters. */
export const MAX_CUSTOM_CSS_LENGTH = 20_000;

export const REFRESH_OPTIONS: readonly SettingOption[] = [
  { value: "off", label: "Off" },
  { value: "30s", label: "30 s" },
  { value: "1m", label: "1 min" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
];

const REFRESH_MS: Readonly<Record<string, number>> = {
  "30s": 30_000,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};

/** Milliseconds between automatic reloads; null when off or unknown. */
export function refreshIntervalMs(value: unknown): number | null {
  return typeof value === "string" ? (REFRESH_MS[value] ?? null) : null;
}

export interface WebviewOptions {
  /** The page to show (normalised), or null when none is set or the stored one is not allowed. */
  url: string | null;
  /** What the user typed, for the address bar. */
  urlText: string;
  transparent: boolean;
  hideScrollbars: boolean;
  zoomPct: number;
  refreshMs: number | null;
  interactive: boolean;
  customCss: string;
}

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;

/** Typed options with safe fallbacks: never throws on odd stored data. */
export function webviewOptions(settings: Pick<OverlayInstanceSettings, "options">): WebviewOptions {
  const o = settings.options;
  const urlText = typeof o[WEBVIEW_KEYS.url] === "string" ? (o[WEBVIEW_KEYS.url] as string) : "";
  const zoom = o[WEBVIEW_KEYS.zoom];
  const css = o[WEBVIEW_KEYS.customCss];
  return {
    url: parseWebPageUrl(urlText),
    urlText: urlText.trim(),
    transparent: o[WEBVIEW_KEYS.transparent] !== false,
    hideScrollbars: o[WEBVIEW_KEYS.hideScrollbars] !== false,
    zoomPct:
      typeof zoom === "number" && Number.isFinite(zoom)
        ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
        : 100,
    refreshMs: refreshIntervalMs(o[WEBVIEW_KEYS.refresh]),
    interactive: o[WEBVIEW_KEYS.interactive] === true,
    customCss: typeof css === "string" ? css.slice(0, MAX_CUSTOM_CSS_LENGTH) : "",
  };
}
