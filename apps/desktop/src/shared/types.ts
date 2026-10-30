import type { CaptureSettings, CaptureStatus } from "./capture-types";

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
}

export interface AppInfo {
  version: string;
  /** Stored settings (what the checkboxes edit). */
  display: DisplaySettings;
  /** Settings in effect for this run (stored settings plus --safe-mode). */
  effective: DisplaySettings;
  safeMode: boolean;
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
  getEditMode: "overlay:get-edit-mode",
  editModeChanged: "overlay:edit-mode-changed",
  resizeBy: "overlay:resize-by",
  getCaptureStatus: "capture:get-status",
  captureStatusChanged: "capture:status-changed",
  getCaptureSettings: "capture:get-settings",
  setCaptureSettings: "capture:set-settings",
} as const;

/** The whole surface exposed to renderers through contextBridge. */
export interface OverlayApi {
  getAppInfo(): Promise<AppInfo>;
  setDisplaySettings(patch: Partial<DisplaySettings>): Promise<DisplaySettings>;
  getMetrics(): Promise<ProcessMetric[]>;
  getEditMode(): Promise<boolean>;
  onEditModeChanged(callback: (editing: boolean) => void): () => void;
  resizeBy(dx: number, dy: number): void;
  getCaptureStatus(): Promise<CaptureStatus>;
  onCaptureStatus(callback: (status: CaptureStatus) => void): () => void;
  getCaptureSettings(): Promise<CaptureSettings>;
  setCaptureSettings(patch: Partial<CaptureSettings>): Promise<CaptureSettings>;
}
