import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PitExitStore } from "@overlay/sim-core";
import { readJsonFile } from "../main/json-file";

export interface PitExitFile {
  version: 1;
  /** Track key to the lap-distance fraction (0..1) where pit road ends. */
  exits: Record<string, number>;
}

/** userData/pit-exits.json */
export function pitExitFile(userData: string): string {
  return join(userData, "pit-exits.json");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keeps entries whose value is a finite number in [0, 1). */
export function parsePitExitFile(raw: unknown): PitExitFile {
  const exits: Record<string, number> = {};
  if (isRecord(raw) && raw.version === 1 && isRecord(raw.exits)) {
    for (const [key, value] of Object.entries(raw.exits)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
        exits[key] = value;
      }
    }
  }
  return { version: 1, exits };
}

/**
 * Learned pit-exit lines, kept in memory and in one JSON file (read once, at construction).
 * Writes are asynchronous and atomic (temp file, then rename), one in flight at a time with the
 * latest content winning; a failure goes to `onError` and never reaches the telemetry loop.
 */
export class FilePitExitStore implements PitExitStore {
  private data: PitExitFile;
  private dirty = false;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly file: string,
    private readonly onError: (message: string) => void = () => {},
  ) {
    this.data = parsePitExitFile(readJsonFile(file));
  }

  load(trackKey: string): number | null {
    return this.data.exits[trackKey] ?? null;
  }

  save(trackKey: string, lapDistPct: number): void {
    if (!Number.isFinite(lapDistPct) || lapDistPct < 0 || lapDistPct >= 1) return;
    this.data = { version: 1, exits: { ...this.data.exits, [trackKey]: lapDistPct } };
    this.dirty = true;
    this.writing ??= this.drain();
  }

  /** Resolves when everything saved so far is on disk (or has failed). */
  idle(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    await Promise.resolve();
    try {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.write(this.data);
        } catch (error) {
          this.onError(`could not save the pit exits: ${String(error)}`);
        }
      }
    } finally {
      this.writing = null;
    }
  }

  private async write(data: PitExitFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data)}\n`, "utf8");
    await rename(tmp, this.file);
  }
}
