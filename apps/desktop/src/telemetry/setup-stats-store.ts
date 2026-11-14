import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  SETUP_MAX_COMBOS,
  parseSetupCombo,
  type SetupCombo,
  type SetupStatsStore,
} from "@overlay/sim-core";
import { readJsonFile } from "../main/json-file";

export interface SetupStatsFile {
  version: 1;
  /** Car and track key (`${sim}|${car}|${track}`) to that combination's setups and pin. */
  combos: Record<string, SetupCombo>;
}

/** userData/setup-stats.json */
export function setupStatsFile(userData: string): string {
  return join(userData, "setup-stats.json");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keeps the combos that parse (see parseSetupCombo); anything else starts empty. */
export function parseSetupStatsFile(raw: unknown): SetupStatsFile {
  const combos: Record<string, SetupCombo> = {};
  if (isRecord(raw) && raw.version === 1 && isRecord(raw.combos)) {
    for (const [key, value] of Object.entries(raw.combos)) {
      const combo = parseSetupCombo(value);
      if (combo !== null) combos[key] = combo;
    }
  }
  return { version: 1, combos };
}

/**
 * Lap statistics per car setup and the pinned baselines, kept in memory and in one JSON file
 * (read once, at construction). At most SETUP_MAX_COMBOS car and track combinations are kept
 * (the one changed longest ago goes first); sim-core caps the setups per combination. Writes are
 * asynchronous and atomic (temp file, then rename), one in flight at a time with the latest
 * content winning, so recording a lap never holds up a telemetry tick. A failure goes to
 * `onError` and never reaches the telemetry loop. The file holds car, track and setup names and
 * lap numbers only, and its contents are never logged.
 */
export class FileSetupStatsStore implements SetupStatsStore {
  private data: SetupStatsFile;
  private dirty = false;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly file: string,
    private readonly onError: (message: string) => void = () => {},
  ) {
    this.data = parseSetupStatsFile(readJsonFile(file));
  }

  load(comboKey: string): SetupCombo | null {
    return this.data.combos[comboKey] ?? null;
  }

  save(comboKey: string, combo: SetupCombo): void {
    const combos = { ...this.data.combos };
    delete combos[comboKey];
    combos[comboKey] = combo;
    const keys = Object.keys(combos);
    if (keys.length > SETUP_MAX_COMBOS) {
      const stamp = (k: string): string => combos[k]?.updatedAt ?? "";
      keys
        .filter((k) => k !== comboKey)
        .sort((a, b) => stamp(a).localeCompare(stamp(b)))
        .slice(0, keys.length - SETUP_MAX_COMBOS)
        .forEach((k) => delete combos[k]);
    }
    this.data = { version: 1, combos };
    this.dirty = true;
    this.writing ??= this.drain();
  }

  /** Resolves when everything saved so far is on disk (or has failed). */
  idle(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    // Start on a later turn, so that changes made in the same tick go out as one write.
    await Promise.resolve();
    try {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.write(this.data);
        } catch (error) {
          this.onError(`could not save the setup statistics: ${String(error)}`);
        }
      }
    } finally {
      this.writing = null;
    }
  }

  private async write(data: SetupStatsFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data)}\n`, "utf8");
    await rename(tmp, this.file);
  }
}
