import type { SimName } from "../../model";

/** A lap kept from an earlier session. `used` is in the unit of the tracker it came from. */
export interface SeedLap {
  used: number;
  lapTimeS: number | null;
}

export type FuelHistoryKind = "fuel" | "energy";

export const FUEL_HISTORY_LAPS = 10;
export const FUEL_HISTORY_MAX_KEYS = 200;

export interface FuelHistoryFile {
  version: 1;
  /** Laps oldest first. */
  entries: Record<string, { laps: SeedLap[]; updatedAt: string }>;
}

/** Where earlier laps are read from and written to; the telemetry process provides a file-backed one. */
export interface FuelHistoryStore {
  /** Synchronous; called when the key changes, never per tick. */
  load(key: string): readonly SeedLap[];
  /** Must not block the tick (queue the write). */
  record(key: string, lap: SeedLap): void;
}

/** Same slug as the track key: lower-case words joined by hyphens, accents removed. */
function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** LMU vehicleName: "<team> <year> #<number>:<livery tag>". */
const LMU_ENTRY_NAME = /^(.+?)\s+\d{4}\s+#\w+:/;

/**
 * The car part of an LMU key. LMU's vehicleName names the team entry, not the car model, so
 * keying on it would give every team, year and number its own history. When the name has the
 * entry shape we key on the car class instead (Limitation: different models in one class, such
 * as two Hypercars, share a history at a track; FuelTracker drops a seed whose average is more than 20 % from the first own lap).
 * Without a class the name is stripped of its "#number:tag" suffix and year. A name without the
 * entry shape (a plain car name) is used as it is.
 */
function lmuCarPart(carName: string, className: string | null): string {
  if (!LMU_ENTRY_NAME.test(carName)) return carName;
  if (className !== null && slug(className) !== "") return className;
  return carName.replace(/\s+#\w+:.*$/, "").replace(/\s+\d{4}$/, "");
}

/** `${sim}|${carSlug}|${trackKey}`: the car and track part of the history keys; null when unknown. `className` is used for LMU only. */
export function carTrackKey(
  sim: SimName | null,
  carName: string | null,
  trackKey: string | null,
  className: string | null = null,
): string | null {
  if (sim === null || carName === null || trackKey === null || trackKey === "") return null;
  const car = slug(sim === "lmu" ? lmuCarPart(carName, className) : carName);
  if (car === "") return null;
  return `${sim}|${car}|${trackKey}`;
}

/** `${kind}|${sim}|${carSlug}|${trackKey}`; null when the sim, car or track is unknown. `className` is used for LMU only. */
export function fuelHistoryKey(
  kind: FuelHistoryKind,
  sim: SimName | null,
  carName: string | null,
  trackKey: string | null,
  className: string | null = null,
): string | null {
  const base = carTrackKey(sim, carName, trackKey, className);
  return base === null ? null : `${kind}|${base}`;
}

/** The reference validity limits, also the energy tracker's (in percent). */
const DEFAULT_LIMITS = { minUse: 0.5, maxUse: 50 };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseLap(raw: unknown, limits: { minUse: number; maxUse: number }): SeedLap | null {
  if (!isRecord(raw)) return null;
  const { used, lapTimeS } = raw;
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  if (used < limits.minUse || used > limits.maxUse) return null;
  const time =
    typeof lapTimeS === "number" && Number.isFinite(lapTimeS) && lapTimeS > 0 ? lapTimeS : null;
  return { used, lapTimeS: time };
}

type Entry = { laps: SeedLap[]; updatedAt: string };

/** Newest first; entries without a date sort last. */
function byFreshness(a: [string, Entry], b: [string, Entry]): number {
  if (a[1].updatedAt === b[1].updatedAt) return 0;
  return a[1].updatedAt < b[1].updatedAt ? 1 : -1;
}

/**
 * Untrusted file data to a valid file: a wrong version or shape gives an empty file; laps outside
 * the limits or not finite are dropped; at most {@link FUEL_HISTORY_LAPS} laps per key (the
 * newest) and {@link FUEL_HISTORY_MAX_KEYS} keys (the most recently updated).
 */
export function parseFuelHistory(
  raw: unknown,
  limits: { minUse: number; maxUse: number } = DEFAULT_LIMITS,
): FuelHistoryFile {
  if (!isRecord(raw) || raw["version"] !== 1 || !isRecord(raw["entries"])) {
    return { version: 1, entries: {} };
  }
  const kept: [string, Entry][] = [];
  for (const [key, value] of Object.entries(raw["entries"])) {
    if (!isRecord(value) || !Array.isArray(value["laps"])) continue;
    const updatedAt = typeof value["updatedAt"] === "string" ? value["updatedAt"] : "";
    const laps: SeedLap[] = [];
    for (const l of value["laps"] as unknown[]) {
      const lap = parseLap(l, limits);
      if (lap !== null) laps.push(lap);
    }
    if (laps.length === 0) continue;
    kept.push([key, { laps: laps.slice(-FUEL_HISTORY_LAPS), updatedAt }]);
  }
  kept.sort(byFreshness);
  return { version: 1, entries: Object.fromEntries(kept.slice(0, FUEL_HISTORY_MAX_KEYS)) };
}

/** Returns a new file with `lap` appended to `key` (newest 10 kept); the stalest keys beyond the cap go. */
export function addHistoryLap(
  file: FuelHistoryFile,
  key: string,
  lap: SeedLap,
  nowIso: string,
): FuelHistoryFile {
  const existing = file.entries[key]?.laps ?? [];
  const merged: Record<string, Entry> = {
    ...file.entries,
    [key]: { laps: [...existing, { ...lap }].slice(-FUEL_HISTORY_LAPS), updatedAt: nowIso },
  };
  const sorted = Object.entries(merged).sort(byFreshness).slice(0, FUEL_HISTORY_MAX_KEYS);
  return { version: 1, entries: Object.fromEntries(sorted) };
}

export function historyLaps(file: FuelHistoryFile, key: string): SeedLap[] {
  return (file.entries[key]?.laps ?? []).map((l) => ({ ...l }));
}
