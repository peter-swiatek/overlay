/**
 * Optional enrichment from recorded `/rest/watch/*` response bodies. We never call the game's REST
 * API from here (and never `getVehicleCondition`); the caller hands us bodies it already has.
 */

export interface LmuRestCar {
  carClass: string | null;
  carNumber: string | null;
}

export interface LmuRestSession {
  /** Game session name such as "PRACTICE1" or "RACE1". */
  session: string | null;
  /** Session length in seconds, as the game shows it (the buffer's end time includes the start offset). */
  maxTimeS: number | null;
}

export interface LmuRestSnapshot {
  /** Keyed by `slotID`, which equals the scoring row `id`. */
  cars: Map<number, LmuRestCar>;
  session: LmuRestSession | null;
}

export function emptyRestSnapshot(): LmuRestSnapshot {
  return { cars: new Map(), session: null };
}

/** Standings body: an array with one object per car. Entries that do not look right are skipped. */
export function parseStandings(body: unknown): Map<number, LmuRestCar> {
  const cars = new Map<number, LmuRestCar>();
  if (!Array.isArray(body)) return cars;
  for (const entry of body) {
    if (!isRecord(entry)) continue;
    const slot = entry["slotID"];
    if (typeof slot !== "number" || !Number.isInteger(slot)) continue;
    cars.set(slot, {
      carClass: nonEmptyString(entry["carClass"]),
      carNumber: nonEmptyString(entry["carNumber"]),
    });
  }
  return cars;
}

export function parseSessionInfo(body: unknown): LmuRestSession | null {
  if (!isRecord(body)) return null;
  const maxTime = body["maxTime"];
  return {
    session: nonEmptyString(body["session"]),
    maxTimeS:
      typeof maxTime === "number" && Number.isFinite(maxTime) && maxTime > 0 ? maxTime : null,
  };
}

/** Folds one recorded REST response into the snapshot; unknown paths and non-200s are ignored. */
export function applyRestResponse(
  snapshot: LmuRestSnapshot,
  response: { path: string; status?: number; body: unknown },
): LmuRestSnapshot {
  if (response.status !== undefined && response.status !== 200) return snapshot;
  const body = typeof response.body === "string" ? safeJson(response.body) : response.body;
  if (response.path === "/rest/watch/standings") {
    const cars = parseStandings(body);
    if (cars.size > 0) return { ...snapshot, cars };
  } else if (response.path === "/rest/watch/sessionInfo") {
    const session = parseSessionInfo(body);
    if (session) return { ...snapshot, session };
  }
  return snapshot;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
