import type { BuildInfo } from "./build-info";
import type { OverlayInstanceSettings, OverlaySettingsPatch } from "@overlay/overlays/contract";
import type { Theme, ThemeImportResult, ThemeState } from "@overlay/theme/types";
import type { TableMetrics } from "@overlay/ui/fit";
import type { AppSettings, AppSettingsPatch } from "./app-settings-types";
import type { CaptureSettings, CaptureStatus } from "./capture-types";
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
  /** Overlay renderer to main: the table font measured at zoom 1, for the window fit. */
  tableMetrics: "overlays:table-metrics",
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
  /** Overlay windows only: the table font measured at zoom 1, for the window fit. */
  reportTableMetrics(metrics: TableMetrics): void;
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
    getActive(): Promise<Theme>;
    setActive(id: string): Promise<ThemeState>;
    save(theme: Theme): Promise<ThemeState>;
    remove(id: string): Promise<ThemeState>;
    importCode(code: string): Promise<ThemeImportResult>;
    exportCode(id: string): Promise<string | null>;
    importFile(): Promise<ThemeImportResult | null>;
    exportFile(id: string): Promise<boolean>;
    onChanged(callback: (active: Theme) => void): () => void;
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
  restartApp(): Promise<void>;
  /** Main window only: quits the app. */
  quit(): Promise<void>;
}
