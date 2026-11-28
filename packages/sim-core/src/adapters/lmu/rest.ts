import type { WheelValues } from "../../model/sim-state";

/**
 * Optional enrichment from the game's REST response bodies: recorded ones in replays, and the
 * repair screen polled by the desktop app's live LMU source. We never call the game's REST API
 * from here (and never `getVehicleCondition`); the caller hands us bodies it already has.
 */

/** The repair and refuel screen's data: a read-only GET that also carries the car's wear. */
export const LMU_REPAIR_PATH = "/rest/garage/UIScreen/RepairAndRefuel";

export interface LmuRestCar {
  carClass: string | null;
  carNumber: string | null;
  /** `fullTeamName`: always the leading part of the scoring vehicleName in the recording. */
  teamName: string | null;
  /** Pit state name such as "NONE" or "EXITING". */
  pitState: string | null;
}

export interface LmuRestSession {
  /** Game session name such as "PRACTICE1" or "RACE1". */
  session: string | null;
  /** Session length in seconds, as the game shows it (the buffer's end time includes the start offset). */
  maxTimeS: number | null;
}

/**
 * The player's damage from the repair screen's `wearables`. Checked against Peter's Le Mans
 * recording (115 bodies, one every 20 s): `body.aero` and all four `suspension` values are 0 on
 * the undamaged car, and after the crash that flattened the rear left tyre the body read aero
 * 0.0533 and suspension 0.057 / 0 / 0.138 / 0 (front left, front right, rear left, rear right),
 * with `tires` 0 on the rear left in the same body; all back to 0 after the reset to the garage.
 * Both are fractions, 0 = undamaged.
 */
export interface LmuRestDamage {
  aero: number | null;
  suspension: WheelValues | null;
}

export interface LmuRestSnapshot {
  /** Keyed by `slotID`, which equals the scoring row `id`. */
  cars: Map<number, LmuRestCar>;
  session: LmuRestSession | null;
  /** From the last repair screen body; null when there is none or the last request failed. */
  damage: LmuRestDamage | null;
}

export function emptyRestSnapshot(): LmuRestSnapshot {
  return { cars: new Map(), session: null, damage: null };
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
      teamName: nonEmptyString(entry["fullTeamName"]),
      pitState: nonEmptyString(entry["pitState"]),
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

const fraction = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;

/** The repair screen body's `wearables`; null when it does not look right. */
export function parseRepairDamage(body: unknown): LmuRestDamage | null {
  if (!isRecord(body)) return null;
  const wear = body["wearables"];
  if (!isRecord(wear)) return null;
  const aero = isRecord(wear["body"]) ? fraction(wear["body"]["aero"]) : null;
  const susp = wear["suspension"];
  let suspension: WheelValues | null = null;
  if (Array.isArray(susp) && susp.length === 4) {
    const [fl, fr, rl, rr] = susp.map(fraction);
    if (fl != null && fr != null && rl != null && rr != null) suspension = { fl, fr, rl, rr };
  }
  return aero === null && suspension === null ? null : { aero, suspension };
}

/**
 * Folds one REST response into the snapshot; unknown paths are ignored. A failed standings or
 * session request keeps the last good one; a failed repair screen request clears the damage, so
 * it is never shown stale.
 */
export function applyRestResponse(
  snapshot: LmuRestSnapshot,
  response: { path: string; status?: number; body: unknown },
): LmuRestSnapshot {
  const ok = response.status === undefined || response.status === 200;
  if (response.path === LMU_REPAIR_PATH) {
    const body = typeof response.body === "string" ? safeJson(response.body) : response.body;
    return { ...snapshot, damage: ok ? parseRepairDamage(body) : null };
  }
  if (!ok) return snapshot;
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
