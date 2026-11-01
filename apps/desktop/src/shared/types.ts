import type { BuildInfo } from "./build-info";
import type { OverlayInstanceSettings, OverlaySettingsPatch } from "@overlay/overlays/contract";
import type { Theme, ThemeImportResult, ThemeState } from "@overlay/theme/types";
import type { AppSettings, AppSettingsPatch } from "./app-settings-types";
import type { CaptureSettings, CaptureStatus } from "./capture-types";
import type { PerfCheckOutcome, PerfProgress } from "./perf-types";
import type { TelemetryEvent, TelemetrySourceChoice, TelemetrySourceView } from "./telemetry-types";

export type OverlayId = "relative" | "inputs";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
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
  overlays: {
    getAll(): Promise<Record<string, OverlayInstanceSettings>>;
    get(id: string): Promise<OverlayInstanceSettings | null>;
    update(id: string, patch: OverlaySettingsPatch): Promise<OverlayInstanceSettings | null>;
    reset(id: string): Promise<OverlayInstanceSettings | null>;
    onChanged(callback: (id: string, settings: OverlayInstanceSettings) => void): () => void;
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
}
