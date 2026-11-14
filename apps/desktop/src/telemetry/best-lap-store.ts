import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LAP_TRACE_BINS,
  type BestLapRecord,
  type BestLapStore,
  type LapTrace,
} from "@overlay/sim-core";
import { readJsonFile } from "../main/json-file";

export const BEST_LAPS_MAX_KEYS = 200;

/** A lap this much faster (seconds) replaces the stored one; closer than this counts as equal. */
const FASTER_BY_S = 0.0005;

export interface BestLapFile {
  version: 1;
  entries: Record<string, { lapTimeS: number; trace: LapTrace | null; updatedAt: string }>;
}

/** userData/best-laps.json */
export function bestLapFile(userData: string): string {
  return join(userData, "best-laps.json");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteArray(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === LAP_TRACE_BINS &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function parseTrace(raw: unknown, lapTimeS: number): LapTrace | null {
  if (!isRecord(raw)) return null;
  const { timeS, speedMps } = raw;
  if (!finiteArray(timeS) || !finiteArray(speedMps)) return null;
  if (timeS[0] !== 0) return null;
  for (let i = 1; i < timeS.length; i++) {
    if ((timeS[i] as number) < (timeS[i - 1] as number)) return null;
  }
  if ((timeS[timeS.length - 1] as number) >= lapTimeS) return null;
  return { timeS: [...timeS], speedMps: [...speedMps] };
}

/**
 * Keeps valid entries only: lapTimeS finite and > 0; a trace only when both arrays have
 * LAP_TRACE_BINS finite numbers, timeS[0] === 0, timeS non-decreasing and below lapTimeS (else
 * the trace is null).
 */
export function parseBestLapFile(raw: unknown): BestLapFile {
  const entries: BestLapFile["entries"] = {};
  if (isRecord(raw) && raw.version === 1 && isRecord(raw.entries)) {
    for (const [key, value] of Object.entries(raw.entries)) {
      if (!isRecord(value)) continue;
      const { lapTimeS, trace, updatedAt } = value;
      if (typeof lapTimeS !== "number" || !Number.isFinite(lapTimeS) || lapTimeS <= 0) continue;
      entries[key] = {
        lapTimeS,
        trace: parseTrace(trace, lapTimeS),
        updatedAt: typeof updatedAt === "string" ? updatedAt : "",
      };
    }
  }
  return { version: 1, entries };
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * All-time best laps, kept in memory and in one JSON file (read once, at construction). Writes are
 * asynchronous and atomic (temp file, then rename), one in flight at a time with the latest
 * content winning, so recording a lap never holds up a telemetry tick. A failure goes to
 * `onError` and never reaches the telemetry loop. The file holds car and track names and lap
 * data only, and its contents are never logged.
 */
export class FileBestLapStore implements BestLapStore {
  private data: BestLapFile;
  private dirty = false;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly file: string,
    private readonly onError: (message: string) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {
    this.data = parseBestLapFile(readJsonFile(file));
  }

  load(key: string): BestLapRecord | null {
    const entry = this.data.entries[key];
    return entry ? { lapTimeS: entry.lapTimeS, trace: entry.trace } : null;
  }

  /**
   * Stores when there is no entry, the lap is faster by >= 0.0005 s, or equal within 0.0005 s and
   * replaces a trace-less entry with a traced one. Evicts the oldest updatedAt beyond the max
   * keys. Rounds times to 0.001 s and speeds to 0.01 m/s.
   */
  record(key: string, lap: BestLapRecord): void {
    if (!Number.isFinite(lap.lapTimeS) || lap.lapTimeS <= 0) return;
    const lapTimeS = r3(lap.lapTimeS);
    const trace =
      lap.trace === null
        ? null
        : parseTrace(
            { timeS: lap.trace.timeS.map(r3), speedMps: lap.trace.speedMps.map(r2) },
            lapTimeS,
          );
    const old = this.data.entries[key];
    if (old) {
      const faster = old.lapTimeS - lapTimeS >= FASTER_BY_S;
      const equal = Math.abs(old.lapTimeS - lapTimeS) < FASTER_BY_S;
      if (!faster && !(equal && old.trace === null && trace !== null)) return;
    }
    const entries = { ...this.data.entries };
    delete entries[key];
    entries[key] = { lapTimeS, trace, updatedAt: this.now().toISOString() };
    const keys = Object.keys(entries);
    if (keys.length > BEST_LAPS_MAX_KEYS) {
      const stamp = (k: string): string => entries[k]?.updatedAt ?? "";
      keys
        .sort((a, b) => stamp(a).localeCompare(stamp(b)))
        .slice(0, keys.length - BEST_LAPS_MAX_KEYS)
        .forEach((k) => delete entries[k]);
    }
    this.data = { version: 1, entries };
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
          this.onError(`could not save the best laps: ${String(error)}`);
        }
      }
    } finally {
      this.writing = null;
    }
  }

  private async write(data: BestLapFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data)}\n`, "utf8");
    await rename(tmp, this.file);
  }
}
