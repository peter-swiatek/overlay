import { join } from "node:path";
import { isTrackOutline, type TrackOutline, type TrackOutlineStore } from "@overlay/sim-core";
import { readJsonFile, writeJsonFileAtomic } from "../main/json-file";

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
 * Files of {@link TrackOutline} in one folder. Writes are small and rare (one per track, once),
 * so they are synchronous and atomic. A failure never reaches the telemetry loop.
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

  save(outline: TrackOutline): void {
    if (!SAFE_KEY.test(outline.trackKey)) return;
    try {
      writeJsonFileAtomic(this.fileOf(outline.trackKey), outline);
    } catch (error) {
      this.onError(`could not save the outline of ${outline.trackKey}: ${String(error)}`);
    }
  }

  private fileOf(trackKey: string): string {
    return join(this.dir, `${trackKey}.json`);
  }
}
