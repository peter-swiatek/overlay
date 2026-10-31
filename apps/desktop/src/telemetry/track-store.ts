import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isTrackOutline, type TrackOutline, type TrackOutlineStore } from "@overlay/sim-core";
import { readJsonFile } from "../main/json-file";

/** Outlines live in userData/tracks, one JSON file per track key. */
export function trackOutlineDir(userData: string): string {
  return join(userData, "tracks");
}

/** The folder passed as `--user-data=<path>` when the main process forks this one. */
export function parseUserDataArg(argv: readonly string[]): string | null {
  const prefix = "--user-data=";
  const arg = argv.find((a) => a.startsWith(prefix));
  const value = arg?.slice(prefix.length) ?? "";
  return value === "" ? null : value;
}

/** Track keys are lower-case words, digits, hyphens and underscores; nothing else is a file name. */
const SAFE_KEY = /^[a-z0-9_-]{1,200}$/;

/**
 * Files of {@link TrackOutline} in one folder. A read is synchronous (once, when the track
 * changes). Writes are asynchronous and atomic (temp file, then rename), one in flight at a time
 * with the latest outline per key winning, so a save never holds up a telemetry tick. A failure
 * never reaches the telemetry loop.
 */
export class FileTrackOutlineStore implements TrackOutlineStore {
  constructor(
    private readonly dir: string,
    private readonly onError: (message: string) => void = () => {},
  ) {}

  load(trackKey: string): TrackOutline | null {
    if (!SAFE_KEY.test(trackKey)) return null;
    const value = readJsonFile(this.fileOf(trackKey));
    return isTrackOutline(value) ? value : null;
  }

  private readonly queued = new Map<string, TrackOutline>();
  private writing: Promise<void> | null = null;

  save(outline: TrackOutline): void {
    if (!SAFE_KEY.test(outline.trackKey)) return;
    this.queued.set(outline.trackKey, outline);
    this.writing ??= this.drain();
  }

  /** Resolves when everything saved so far is on disk (or has failed). */
  idle(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    try {
      for (;;) {
        const next = this.queued.entries().next();
        if (next.done) return;
        const [key, outline] = next.value;
        this.queued.delete(key);
        try {
          await this.write(key, outline);
        } catch (error) {
          this.onError(`could not save the outline of ${key}: ${String(error)}`);
        }
      }
    } finally {
      this.writing = null;
    }
  }

  private async write(key: string, outline: TrackOutline): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.fileOf(key);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(outline), "utf8");
    await rename(tmp, file);
  }

  private fileOf(trackKey: string): string {
    return join(this.dir, `${trackKey}.json`);
  }
}
