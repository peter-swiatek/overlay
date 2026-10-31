import type { TelemetrySourceChoice } from "../shared/telemetry-types";
import { DEFAULT_RETENTION_DAYS, normalizeRetentionDays } from "../recorder/retention";
import { readJsonFile, writeJsonFileAtomic } from "./json-file";

export interface TelemetrySettings {
  source: TelemetrySourceChoice;
  replayPath: string | null;
  /** Playback factor for replay, 0 to 16; 0 = as fast as possible. */
  replaySpeed: number;
  /** Days to keep telemetry files (tier 2), at least 30; read when the telemetry process starts. */
  retentionDays: number;
}

export const TELEMETRY_SOURCES: readonly TelemetrySourceChoice[] = [
  "auto",
  "iracing",
  "lmu",
  "replay",
  "mock",
];
export const MAX_REPLAY_SPEED = 16;

export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = {
  source: "auto",
  replayPath: null,
  replaySpeed: 1,
  retentionDays: DEFAULT_RETENTION_DAYS,
};

/** Keeps only known keys; anything invalid falls back to its default. */
export function parseTelemetrySettings(raw: unknown): TelemetrySettings {
  const out = { ...DEFAULT_TELEMETRY_SETTINGS };
  if (typeof raw !== "object" || raw === null) return out;
  const v = raw as Record<string, unknown>;
  const source = v["source"];
  if (TELEMETRY_SOURCES.includes(source as TelemetrySourceChoice)) {
    out.source = source as TelemetrySourceChoice;
  }
  if (typeof v["replayPath"] === "string" && v["replayPath"].length > 0) {
    out.replayPath = v["replayPath"];
  }
  const speed = v["replaySpeed"];
  if (typeof speed === "number" && Number.isFinite(speed)) {
    out.replaySpeed = Math.min(MAX_REPLAY_SPEED, Math.max(0, speed));
  }
  if ("retentionDays" in v) out.retentionDays = normalizeRetentionDays(v["retentionDays"]);
  return out;
}

export interface TelemetrySettingsStorage {
  load(): TelemetrySettings;
  update(patch: unknown): TelemetrySettings;
}

export class TelemetrySettingsStore implements TelemetrySettingsStorage {
  constructor(private readonly file: string) {}

  load(): TelemetrySettings {
    return parseTelemetrySettings(readJsonFile(this.file));
  }

  update(patch: unknown): TelemetrySettings {
    const merged = {
      ...this.load(),
      ...(typeof patch === "object" && patch !== null ? patch : {}),
    };
    const next = parseTelemetrySettings(merged);
    writeJsonFileAtomic(this.file, next);
    return next;
  }
}
