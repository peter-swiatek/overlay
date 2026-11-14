import type { PlayerSetup } from "../../model";
import {
  SETUP_MAX_PER_COMBO,
  SETUP_RECENT_LAPS,
  type SetupCombo,
  type SetupLap,
  type SetupRecord,
  type SetupSide,
} from "./types";

/**
 * The key a setup's laps are kept under: its name without ".sto", with "*" added when it was
 * changed in the garage and not saved (those laps were not driven on the named setup). Null for
 * a blank name.
 */
export function setupKeyOf(setup: PlayerSetup | null | undefined): string | null {
  if (setup === null || setup === undefined) return null;
  const name = setup.name.trim().replace(/\.sto$/i, "");
  if (name === "") return null;
  return setup.modified ? `${name}*` : name;
}

export function emptySetupCombo(): SetupCombo {
  return { baseline: null, setups: {}, updatedAt: "" };
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const r2 = (n: number): number => Math.round(n * 100) / 100;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;

function pushRecent(list: readonly number[], value: number | null): number[] {
  if (value === null) return [...list];
  return [value, ...list].slice(0, SETUP_RECENT_LAPS);
}

function bestSectors(
  old: readonly (number | null)[] | null,
  times: readonly (number | null)[] | null,
): (number | null)[] | null {
  if (times === null || times.length === 0) return old === null ? null : [...old];
  // A different sector layout starts over.
  const base = old !== null && old.length === times.length ? old : times.map(() => null);
  return base.map((b, i) => {
    const t = times[i] ?? null;
    if (!positive(t)) return b;
    const v = r3(t);
    return b === null || v < b ? v : b;
  });
}

/**
 * Adds one valid lap to a setup's record and returns the new combo (the input is not changed).
 * Keeps at most {@link SETUP_MAX_PER_COMBO} setups, dropping the one used longest ago, but never
 * the pinned baseline or the setup just driven.
 */
export function addSetupLap(
  combo: SetupCombo,
  key: string,
  lap: SetupLap,
  nowIso: string,
): SetupCombo {
  if (!positive(lap.lapTimeS)) return combo;
  const old = combo.setups[key];
  const lapTimeS = r3(lap.lapTimeS);
  const record: SetupRecord = {
    laps: (old?.laps ?? 0) + 1,
    bestLapS:
      old === undefined || old.bestLapS === null || lapTimeS < old.bestLapS
        ? lapTimeS
        : old.bestLapS,
    recentLapsS: pushRecent(old?.recentLapsS ?? [], lapTimeS),
    bestSectorsS: bestSectors(old?.bestSectorsS ?? null, lap.sectorTimes),
    recentTopSpeedsMps: pushRecent(
      old?.recentTopSpeedsMps ?? [],
      positive(lap.topSpeedMps) ? r2(lap.topSpeedMps) : null,
    ),
    recentFuelL: pushRecent(
      old?.recentFuelL ?? [],
      positive(lap.fuelUsedL) ? r3(lap.fuelUsedL) : null,
    ),
    updatedAt: nowIso,
  };
  const setups: Record<string, SetupRecord> = { ...combo.setups };
  delete setups[key];
  setups[key] = record;
  const keys = Object.keys(setups);
  if (keys.length > SETUP_MAX_PER_COMBO) {
    const stamp = (k: string): string => setups[k]?.updatedAt ?? "";
    keys
      .filter((k) => k !== key && k !== combo.baseline)
      .sort((a, b) => stamp(a).localeCompare(stamp(b)))
      .slice(0, keys.length - SETUP_MAX_PER_COMBO)
      .forEach((k) => delete setups[k]);
  }
  return { baseline: combo.baseline, setups, updatedAt: nowIso };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** The published side for a setup; a setup without laps has its name and no numbers. */
export function setupSide(key: string, record: SetupRecord | undefined): SetupSide {
  return {
    name: key,
    laps: record?.laps ?? 0,
    bestLapS: record?.bestLapS ?? null,
    avgLapS: mean(record?.recentLapsS ?? []),
    sectorsS: record?.bestSectorsS ?? null,
    topSpeedMps: mean(record?.recentTopSpeedsMps ?? []),
    fuelPerLapL: mean(record?.recentFuelL ?? []),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numbers(v: unknown, valid: (n: number) => boolean): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is number => finite(n) && valid(n)).slice(0, SETUP_RECENT_LAPS);
}

function parseRecord(raw: unknown): SetupRecord | null {
  if (!isRecord(raw)) return null;
  const { laps, bestLapS, recentLapsS, bestSectorsS, recentTopSpeedsMps, recentFuelL, updatedAt } =
    raw;
  if (!finite(laps) || !Number.isInteger(laps) || laps < 1) return null;
  const sectors = Array.isArray(bestSectorsS)
    ? bestSectorsS.map((s) => (positive(s) ? s : null))
    : null;
  return {
    laps,
    bestLapS: positive(bestLapS) ? bestLapS : null,
    recentLapsS: numbers(recentLapsS, (n) => n > 0),
    bestSectorsS: sectors !== null && sectors.length > 0 ? sectors : null,
    recentTopSpeedsMps: numbers(recentTopSpeedsMps, (n) => n > 0),
    recentFuelL: numbers(recentFuelL, (n) => n > 0),
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
  };
}

/** A combo read from a file: bad setups are dropped, a baseline is kept only as a string. */
export function parseSetupCombo(raw: unknown): SetupCombo | null {
  if (!isRecord(raw)) return null;
  const setups: Record<string, SetupRecord> = {};
  if (isRecord(raw.setups)) {
    for (const [key, value] of Object.entries(raw.setups)) {
      const record = key.trim() === "" ? null : parseRecord(value);
      if (record !== null) setups[key] = record;
    }
  }
  const baseline =
    typeof raw.baseline === "string" && raw.baseline.trim() !== "" ? raw.baseline : null;
  return {
    baseline,
    setups,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}
