export type CaptureSim = "iracing" | "lmu";

export interface CaptureStatus {
  recording: boolean;
  /** Sim being written to the current file, if any. */
  sim: CaptureSim | null;
  file: string | null;
  sizeBytes: number;
  filesWritten: number;
  live: Record<CaptureSim, boolean>;
  /** Frames (LMU) or var buffers (iRacing) written per second, over the last second. */
  fps: Record<CaptureSim, number>;
  frames: Record<CaptureSim, number>;
  error: string | null;
}

export const IDLE_CAPTURE_STATUS: CaptureStatus = {
  recording: false,
  sim: null,
  file: null,
  sizeBytes: 0,
  filesWritten: 0,
  live: { iracing: false, lmu: false },
  fps: { iracing: 0, lmu: 0 },
  frames: { iracing: 0, lmu: 0 },
  error: null,
};

export interface CaptureSettings {
  /** LMU full-buffer frame rate while recording, 1 to 20 Hz. */
  lmuFrameHz: number;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = { lmuFrameHz: 5 };
export const MIN_LMU_FRAME_HZ = 1;
export const MAX_LMU_FRAME_HZ = 20;

export const MARKER_PRESETS = [
  "quali -> race",
  "pit stop",
  "driver swap",
  "incident",
  "other",
] as const;

/** Main process to capture utility process. */
export type CaptureCommand =
  | { type: "start"; dir: string; appVersion: string; os: string; settings: CaptureSettings }
  | { type: "stop" }
  | { type: "marker"; label: string }
  | { type: "settings"; settings: CaptureSettings };

/** Capture utility process to main process. */
export type CaptureEvent =
  { type: "status"; status: CaptureStatus } | { type: "stopped"; status: CaptureStatus };
