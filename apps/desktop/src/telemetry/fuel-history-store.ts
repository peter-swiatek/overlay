import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  addHistoryLap,
  historyLaps,
  parseFuelHistory,
  type FuelHistoryFile,
  type FuelHistoryStore,
  type SeedLap,
} from "@overlay/sim-core";
import { readJsonFile } from "../main/json-file";

/** The last valid laps of fuel and energy use live in userData/fuel-history.json. */
export function fuelHistoryFile(userData: string): string {
  return join(userData, "fuel-history.json");
}

/**
 * Fuel use of earlier sessions, kept in memory and in one JSON file. The file is read once, at
 * construction. Writes are asynchronous and atomic (temp file, then rename), one in flight at a
 * time with the latest content winning, so recording a lap never holds up a telemetry tick.
 * A failure goes to `onError` and never reaches the telemetry loop. The file holds car and track
 * names and fuel numbers only, and its contents are never logged.
 */
export class FileFuelHistoryStore implements FuelHistoryStore {
  private data: FuelHistoryFile;
  private dirty = false;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly file: string,
    private readonly onError: (message: string) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {
    this.data = parseFuelHistory(readJsonFile(file));
  }

  load(key: string): readonly SeedLap[] {
    return historyLaps(this.data, key);
  }

  record(key: string, lap: SeedLap): void {
    this.data = addHistoryLap(this.data, key, lap, this.now().toISOString());
    this.dirty = true;
    this.writing ??= this.drain();
  }

  /** Resolves when everything recorded so far is on disk (or has failed). */
  idle(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    // Start on a later turn, so that laps recorded in the same tick go out as one write.
    await Promise.resolve();
    try {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.write(this.data);
        } catch (error) {
          this.onError(`could not save the fuel history: ${String(error)}`);
        }
      }
    } finally {
      this.writing = null;
    }
  }

  private async write(data: FuelHistoryFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data)}\n`, "utf8");
    await rename(tmp, this.file);
  }
}
