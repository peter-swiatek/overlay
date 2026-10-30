import {
  DEFAULT_CAPTURE_SETTINGS,
  MAX_LMU_FRAME_HZ,
  MIN_LMU_FRAME_HZ,
  type CaptureSettings,
} from "../shared/capture-types";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";

/** Keeps only known keys, with values clamped to what the capture tool supports. */
export function parseCaptureSettings(raw: unknown): CaptureSettings {
  const out = { ...DEFAULT_CAPTURE_SETTINGS };
  if (typeof raw !== "object" || raw === null) return out;
  const hz = (raw as Record<string, unknown>)["lmuFrameHz"];
  if (typeof hz === "number" && Number.isFinite(hz)) {
    out.lmuFrameHz = Math.min(Math.max(hz, MIN_LMU_FRAME_HZ), MAX_LMU_FRAME_HZ);
  }
  return out;
}

export class CaptureSettingsStore {
  constructor(private readonly file: string) {}

  load(): CaptureSettings {
    return parseCaptureSettings(readJsonFile(this.file));
  }

  update(patch: unknown): CaptureSettings {
    const merged = {
      ...this.load(),
      ...(typeof patch === "object" && patch !== null ? patch : {}),
    };
    const next = parseCaptureSettings(merged);
    writeJsonFileAtomic(this.file, next);
    return next;
  }
}
