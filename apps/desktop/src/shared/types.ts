import type { BuildInfo } from "./build-info";
import type {
  OverlayInstanceSettings,
  OverlaySettingsPatch,
  PageRect,
} from "@overlay/overlays/contract";
import type { ChatEvent } from "@overlay/overlays/twitch-chat";
import type {
  ActiveTheme,
  Theme,
  ThemeImportResult,
  ThemeState,
  Typography,
} from "@overlay/theme/types";
import type { TableMetrics } from "@overlay/ui/fit";
import type { AppSettings, AppSettingsPatch } from "./app-settings-types";
import type { CaptureSettings, CaptureStatus } from "./capture-types";
import type { LayoutMatch, LayoutsState } from "./layout-types";
import type { PerfCheckOutcome, PerfProgress } from "./perf-types";
import type { TelemetryEvent, TelemetrySourceChoice, TelemetrySourceView } from "./telemetry-types";

export type { TableMetrics };

export type OverlayId = "relative" | "inputs";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Main-window state shared by the top bar, the tray and Ctrl+Shift+F10.
 * `overlaysLocked` is the inverse of the manager's edit mode: locked means clicks pass through.
 */
export interface AppState {
  overlaysVisible: boolean;
  overlaysLocked: boolean;
}

/** An overlay window's real on-screen size: DIP width/height (already scaled) and its scale. */
export interface OverlaySize {
  width: number;
  height: number;
  scalePct: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Display fallbacks for machines where transparent windows render black. Applied on next start. */
export interface DisplaySettings {
  disableHardwareAcceleration: boolean;
  disableDirectComposition: boolean;
  opacityWorkaround: boolean;
  /** Turns off Chromium's native window occlusion tracking (applied at startup by the display ticket). */
  disableNativeOcclusion: boolean;
}

export interface AppInfo {
  version: string;
  /** Version, git sha, build date and channel embedded when this build was made. */
  build: BuildInfo;
  /** Stored settings (what the checkboxes edit). */
  display: DisplaySettings;
  /** Settings in effect for this run (stored settings plus --safe-mode). */
  effective: DisplaySettings;
  safeMode: boolean;
  /** True in an installed build (app.isPackaged). */
  isPackaged: boolean;
}

export interface ProcessMetric {
  type: string;
  count: number;
  cpuPercent: number;
  memoryMb: number;
}

export const IPC = {
  getAppInfo: "app:get-info",
  setDisplaySettings: "settings:set-display",
  getMetrics: "metrics:get",
  perfStart: "perf:start",
  perfCancel: "perf:cancel",
  perfProgress: "perf:progress",
  getEditMode: "overlay:get-edit-mode",
  editModeChanged: "overlay:edit-mode-changed",
  resizeBy: "overlay:resize-by",
  /** Overlay renderer to main: the smallest size its content needs, in CSS px (= window DIPs). */
  contentMinSize: "overlays:content-min-size",
  /**
   * Overlay renderer to main: the natural size of its content (window DIPs, title bar included),
   * for overlays whose manifest `fitContent` makes the window follow the content.
   */
  contentFitSize: "overlays:content-fit-size",
  /** Overlay renderer to main: the table font measured at zoom 1, for the window fit. */
  tableMetrics: "overlays:table-metrics",
  /**
   * Webview overlay windows to main: where the embedded page goes (`PageRect`, CSS px of the
   * window) or null to hide it. Main loads the page itself from the stored settings.
   */
  webPageRect: "overlays:web-page-rect",
  /** Twitch Chat overlay windows to main: send me this instance's chat so far (then the news). */
  twitchChatHello: "twitch-chat:hello",
  /** Main to a Twitch Chat overlay window: a `ChatEvent` for its channel. */
  twitchChatEvent: "twitch-chat:event",
  getCaptureStatus: "capture:get-status",
  captureStatusChanged: "capture:status-changed",
  getCaptureSettings: "capture:get-settings",
  setCaptureSettings: "capture:set-settings",
  /** Renderer to main: ask for a telemetry port at this rate (Hz). */
  telemetrySubscribe: "telemetry:subscribe",
  /** Main to renderer: carries the MessagePort that streams telemetry frames. */
  telemetryPort: "telemetry:port",
  overlaysGetAll: "overlays:get-all",
  overlaysGet: "overlays:get",
  overlaysUpdate: "overlays:update",
  overlaysReset: "overlays:reset",
  overlaysChanged: "overlays:changed",
  /** Main window only: adds an instance of the overlay of the given instance id; returns its id. */
  overlaysAddInstance: "overlays:add-instance",
  /** Main window only: removes an added instance; returns whether it was removed. */
  overlaysRemoveInstance: "overlays:remove-instance",
  /** Main to every window: carries the id of an instance that was removed. */
  overlaysRemoved: "overlays:removed",
  themeGetState: "theme:get-state",
  themeGetActive: "theme:get-active",
  themeSetTypography: "theme:set-typography",
  themeSetActive: "theme:set-active",
  themeSave: "theme:save",
  themeRemove: "theme:remove",
  themeImportCode: "theme:import-code",
  themeExportCode: "theme:export-code",
  themeImportFile: "theme:import-file",
  themeExportFile: "theme:export-file",
  themeChanged: "theme:changed",
  appSettingsGet: "app-settings:get",
  appSettingsUpdate: "app-settings:update",
  appSettingsChanged: "app-settings:changed",
  telemetryGetSource: "telemetry:get-source",
  telemetrySetSource: "telemetry:set-source",
  telemetryPickReplay: "telemetry:pick-replay",
  telemetryGetStatus: "telemetry:get-status",
  telemetryStatusChanged: "telemetry:status-changed",
  telemetrySourceChanged: "telemetry:source-changed",
  appRestart: "app:restart",
  /** Main window only: returns `AppState`. */
  appStateGet: "app-state:get",
  /** Main window only: takes `Partial<AppState>`, returns the new `AppState`. */
  appStateSet: "app-state:set",
  /** Main to every window: carries the new `AppState` after any change (tray, shortcut, window). */
  appStateChanged: "app-state:changed",
  /** Main window only: returns `Record<overlayId, OverlaySize>`. */
  overlaysGetSizes: "overlays:get-sizes",
  /** Main to the main window: carries `Record<overlayId, OverlaySize>` after a layout save. */
  overlaysSizesChanged: "overlays:sizes-changed",
  /** Main window only: quits the whole app (overlays included). */
  appQuit: "app:quit",
  /** Renderer to main: the user's own manufacturer logos (make id -> data URL). */
  logosGet: "logos:get",
  /** Main to every window: the logos changed (carries the whole map). */
  logosChanged: "logos:changed",
  /** Main window only: returns `LayoutsState`. */
  layoutsGet: "layouts:get",
  /** Main window only: applies a group; returns `LayoutsState`. */
  layoutsActivate: "layouts:activate",
  /** Main window only: a new group copying the active one, made active; returns `LayoutsState`. */
  layoutsCreate: "layouts:create",
  layoutsDuplicate: "layouts:duplicate",
  layoutsRename: "layouts:rename",
  layoutsRemove: "layouts:remove",
  /** Main window only: takes a layout id and a `Partial<LayoutMatch>`. */
  layoutsSetMatch: "layouts:set-match",
  layoutsSetAutoSwitch: "layouts:set-auto-switch",
  /** Main window only: takes a group id, an instance id and on/off. */
  layoutsSetEnabled: "layouts:set-enabled",
  /** Main to the main window: carries the new `LayoutsState`. */
  layoutsChanged: "layouts:changed",
} as const;

/** The whole surface exposed to renderers through contextBridge. */
export interface OverlayApi {
  getAppInfo(): Promise<AppInfo>;
  setDisplaySettings(patch: Partial<DisplaySettings>): Promise<DisplaySettings>;
  getMetrics(): Promise<ProcessMetric[]>;
  /** CPU budget check (settings window only): runs about two minutes, resolves with the outcome. */
  startPerfCheck(): Promise<PerfCheckOutcome>;
  cancelPerfCheck(): Promise<void>;
  onPerfProgress(callback: (progress: PerfProgress) => void): () => void;
  getEditMode(): Promise<boolean>;
  onEditModeChanged(callback: (editing: boolean) => void): () => void;
  resizeBy(dx: number, dy: number): void;
  /** Overlay windows only: reports the smallest window size the content needs (CSS px). */
  reportContentMinSize(size: Size): void;
  /** The natural size of the content, for overlays whose window fits it (see `contentFitSize`). */
  reportContentFitSize(size: Size): void;
  /** Overlay windows only: the table font measured at zoom 1, for the window fit. */
  reportTableMetrics(metrics: TableMetrics): void;
  /** Webview overlay windows only: where the embedded page goes, or null to hide it. */
  reportWebPageRect(rect: PageRect | null): void;
  /**
   * Twitch Chat overlay windows only: follows this instance's chat, starting with a snapshot.
   * Main owns the (read-only) connection; returns the unsubscribe function.
   */
  onTwitchChat(callback: (event: ChatEvent) => void): () => void;
  /** The user's own manufacturer logos (<userData>/logos), make id -> data URL. */
  logos: {
    get(): Promise<Record<string, string>>;
    onChanged(callback: (logos: Record<string, string>) => void): () => void;
  };
  getCaptureStatus(): Promise<CaptureStatus>;
  onCaptureStatus(callback: (status: CaptureStatus) => void): () => void;
  getCaptureSettings(): Promise<CaptureSettings>;
  setCaptureSettings(patch: Partial<CaptureSettings>): Promise<CaptureSettings>;
  /**
   * Asks main for a telemetry MessagePort at `rateHz` (1 to 60). The port arrives as a
   * `window.postMessage({ type: "telemetry-port" }, "*", [port])`; the page must already be
   * listening. A higher rate than before brokers a new port.
   */
  subscribeTelemetry(rateHz: number): void;
  /** Overlay settings, keyed by instance id ("relative", "relative:2"; see @overlay/overlays/instances). */
  overlays: {
    getAll(): Promise<Record<string, OverlayInstanceSettings>>;
    get(id: string): Promise<OverlayInstanceSettings | null>;
    update(id: string, patch: OverlaySettingsPatch): Promise<OverlayInstanceSettings | null>;
    reset(id: string): Promise<OverlayInstanceSettings | null>;
    onChanged(callback: (id: string, settings: OverlayInstanceSettings) => void): () => void;
    /**
     * Main window only: adds an instance of the overlay `sourceId` belongs to, copying its
     * settings; resolves with the new instance id, or null when none could be added.
     */
    addInstance(sourceId: string): Promise<string | null>;
    /** Main window only: removes an added instance (never instance 1). */
    removeInstance(id: string): Promise<boolean>;
    onRemoved(callback: (id: string) => void): () => void;
    /** Main window only: real on-screen size of every overlay window, keyed by overlay id. */
    getSizes(): Promise<Record<string, OverlaySize>>;
    /** Main window only: fires after an overlay is resized or rescaled (debounced layout save). */
    onSizesChanged(callback: (sizes: Record<string, OverlaySize>) => void): () => void;
  };
  /** Main window only: overlay visibility and lock state. */
  appState: {
    get(): Promise<AppState>;
    set(patch: Partial<AppState>): Promise<AppState>;
    onChanged(callback: (state: AppState) => void): () => void;
  };
  theme: {
    getState(): Promise<ThemeState>;
    /** The active theme's colours and the global typography. */
    getActive(): Promise<ActiveTheme>;
    setActive(id: string): Promise<ThemeState>;
    /** Changes the global typography (applies to every theme, built-in or custom). */
    setTypography(patch: Partial<Typography>): Promise<ThemeState>;
    save(theme: Theme): Promise<ThemeState>;
    remove(id: string): Promise<ThemeState>;
    importCode(code: string): Promise<ThemeImportResult>;
    exportCode(id: string): Promise<string | null>;
    importFile(): Promise<ThemeImportResult | null>;
    exportFile(id: string): Promise<boolean>;
    /** Fires when the active theme, its colours or the typography change. */
    onChanged(callback: (active: ActiveTheme) => void): () => void;
  };
  appSettings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsPatch): Promise<AppSettings>;
    onChanged(callback: (settings: AppSettings) => void): () => void;
  };
  telemetry: {
    getSource(): Promise<TelemetrySourceView>;
    setSource(source: Exclude<TelemetrySourceChoice, "replay">): Promise<TelemetrySourceView>;
    pickReplayFile(): Promise<TelemetrySourceView>;
    getStatus(): Promise<TelemetryEvent | null>;
    onStatus(callback: (status: TelemetryEvent) => void): () => void;
    onSourceChanged(callback: (view: TelemetrySourceView) => void): () => void;
  };
  /** Main window only: the overlay groups and the automatic switch. Each call returns the new state. */
  layouts: {
    get(): Promise<LayoutsState>;
    activate(id: string): Promise<LayoutsState>;
    create(): Promise<LayoutsState>;
    duplicate(id: string): Promise<LayoutsState>;
    rename(id: string, name: string): Promise<LayoutsState>;
    remove(id: string): Promise<LayoutsState>;
    setMatch(id: string, patch: Partial<LayoutMatch>): Promise<LayoutsState>;
    setAutoSwitch(on: boolean): Promise<LayoutsState>;
    /** Turns an overlay instance on or off in one group (at once on screen for the active group). */
    setEnabled(id: string, instanceId: string, on: boolean): Promise<LayoutsState>;
    onChanged(callback: (state: LayoutsState) => void): () => void;
  };
  restartApp(): Promise<void>;
  /** Main window only: quits the app. */
  quit(): Promise<void>;
}
