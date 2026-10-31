import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { ByteSink } from "@overlay/sim-core";

export const TIER2_EXTENSION = ".otlm";
export const MANIFEST_NAME = "manifest.json";

/** "2026-10" for a Unix time, in UTC so that a file never moves when the zone changes. */
export function monthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Forward-slash path of a session's tier 2 file below the telemetry directory. */
export function tier2RelativePath(sim: string, startedAtMs: number, sessionId: string): string {
  return `${sim}/${monthOf(startedAtMs)}/${sessionId}${TIER2_EXTENSION}`;
}

/** Appends to a file with plain writes, so that everything written so far survives a crash. */
export class FileSink implements ByteSink {
  private fd: number | null;

  constructor(readonly path: string) {
    this.fd = openSync(path, "a");
  }

  append(bytes: Uint8Array): void {
    if (this.fd === null) return;
    let written = 0;
    while (written < bytes.length) written += writeSync(this.fd, bytes, written);
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

export function openTier2File(telemetryDir: string, relativePath: string): FileSink {
  const path = join(telemetryDir, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  return new FileSink(path);
}

export interface ManifestFile {
  file: string;
  bytes: number;
  /** Unix milliseconds of the last write. */
  modifiedAt: number;
}

/** What `manifest.json` of a month directory holds: the files a future upload would look at. */
export interface Manifest {
  version: 1;
  generatedAt: number;
  files: ManifestFile[];
}

/** Rewrites the month's manifest from the files that are there. */
export function writeManifest(monthDir: string, nowMs: number): Manifest {
  const files: ManifestFile[] = [];
  for (const name of readdirSync(monthDir).sort()) {
    if (!name.endsWith(TIER2_EXTENSION)) continue;
    const stat = statSync(join(monthDir, name));
    files.push({ file: name, bytes: stat.size, modifiedAt: Math.round(stat.mtimeMs) });
  }
  const manifest: Manifest = { version: 1, generatedAt: nowMs, files };
  const target = join(monthDir, MANIFEST_NAME);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temp, target);
  return manifest;
}
