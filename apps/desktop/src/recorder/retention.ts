import { existsSync, readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_NAME, TIER2_EXTENSION, writeManifest } from "./files";

export const DEFAULT_RETENTION_DAYS = 60;
export const MIN_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days to keep tier 2 files: the default for anything unusable, never below the minimum. */
export function normalizeRetentionDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_RETENTION_DAYS;
  return Math.max(MIN_RETENTION_DAYS, Math.floor(value));
}

export interface PruneResult {
  /** Paths of the removed files relative to the telemetry directory, with forward slashes. */
  removed: string[];
  kept: number;
}

function subdirectories(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Deletes tier 2 files (`<sim>/<yyyy-mm>/*.otlm`) last written more than `retentionDays` ago and
 * brings the month manifests up to date. Tier 1 (the SQLite file) lives elsewhere and is never
 * touched; a session whose telemetry file was pruned keeps its summary rows.
 */
export function pruneTelemetryFiles(
  telemetryDir: string,
  retentionDays: number,
  nowMs: number,
): PruneResult {
  const cutoff = nowMs - normalizeRetentionDays(retentionDays) * DAY_MS;
  const result: PruneResult = { removed: [], kept: 0 };
  for (const sim of subdirectories(telemetryDir)) {
    for (const month of subdirectories(join(telemetryDir, sim))) {
      const dir = join(telemetryDir, sim, month);
      let removedHere = 0;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(TIER2_EXTENSION)) continue;
        if (statSync(join(dir, name)).mtimeMs >= cutoff) {
          result.kept++;
          continue;
        }
        rmSync(join(dir, name), { force: true });
        result.removed.push(`${sim}/${month}/${name}`);
        removedHere++;
      }
      if (removedHere > 0) refreshMonth(dir, nowMs);
    }
  }
  return result;
}

/** Rewrites the manifest, or removes the whole month directory when nothing is left in it. */
function refreshMonth(dir: string, nowMs: number): void {
  const left = readdirSync(dir).filter((n) => n.endsWith(TIER2_EXTENSION));
  if (left.length > 0) {
    writeManifest(dir, nowMs);
    return;
  }
  rmSync(join(dir, MANIFEST_NAME), { force: true });
  rmSync(join(dir, `${MANIFEST_NAME}.tmp`), { force: true });
  // Only an empty directory goes; anything unexpected in it stays.
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}
