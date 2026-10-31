import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { migrate } from "./migrations";

/** What a session row says about the session; every field can be filled in later. */
export interface SessionPatch {
  sim?: string | null;
  track_name?: string | null;
  track_config?: string | null;
  track_length_m?: number | null;
  car_name?: string | null;
  car_class?: string | null;
  car_number?: string | null;
  session_type?: string | null;
  timing?: string | null;
  total_laps?: number | null;
  total_time_s?: number | null;
  ended_at?: number | null;
  end_reason?: string | null;
  air_temp_c?: number | null;
  track_temp_c?: number | null;
  wetness_max?: number | null;
  tier2_path?: string | null;
}

export interface NewSession extends Omit<SessionPatch, "sim"> {
  id: string;
  sim: string;
  source: string;
  started_at: number;
}

export interface NewLap {
  id: string;
  session_id: string;
  /** 1..n in the order the rows were written; lap numbers repeat after counter resets. */
  lap_index: number;
  lap_number: number;
  lap_time_s: number | null;
  sector_times_json: string | null;
  fuel_valid: boolean;
  fuel_invalid_reason: string | null;
  fuel_used_l: number | null;
  fuel_start_l: number | null;
  fuel_end_l: number | null;
  energy_used: number | null;
  position_end: number | null;
  incidents_delta: number | null;
  pit_lap: boolean;
  track_temp_c: number | null;
  tyre_wear_delta: number | null;
  started_session_s: number | null;
  ended_session_s: number | null;
}

export interface NewStint {
  id: string;
  session_id: string;
  stint_number: number;
  start_lap: number;
  fuel_added_at_start_l: number | null;
}

export interface NewPitStop {
  id: string;
  session_id: string;
  lap: number;
  entry_time_s: number | null;
  exit_time_s: number | null;
  stationary_s: number;
  fuel_added_l: number;
}

export interface NewIncident {
  id: string;
  session_id: string;
  lap: number;
  time_s: number | null;
  count_delta: number;
}

const SESSION_PATCH_COLUMNS: readonly (keyof SessionPatch)[] = [
  "sim",
  "track_name",
  "track_config",
  "track_length_m",
  "car_name",
  "car_class",
  "car_number",
  "session_type",
  "timing",
  "total_laps",
  "total_time_s",
  "ended_at",
  "end_reason",
  "air_temp_c",
  "track_temp_c",
  "wetness_max",
  "tier2_path",
];

/** Opens the tier 1 database: WAL, so a crash leaves everything up to the last commit. */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 200");
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Typed writes to the tier 1 tables. Callers batch them with `transaction`. */
export class SessionStore {
  private readonly statements = new Map<string, StatementSync>();

  constructor(readonly db: DatabaseSync) {}

  /** Prepared statements are kept: the same few run all session long. */
  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  static open(path: string): SessionStore {
    return new SessionStore(openDatabase(path));
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  transaction(work: () => void): void {
    this.db.exec("BEGIN");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  insertSession(row: NewSession, nowMs: number): void {
    this.stmt(
      `INSERT INTO sessions (id, created_at, updated_at, sim, source, started_at, track_name,
           track_config, track_length_m, car_name, car_class, car_number, session_type, timing,
           total_laps, total_time_s, air_temp_c, track_temp_c, wetness_max, tier2_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      nowMs,
      nowMs,
      row.sim,
      row.source,
      row.started_at,
      row.track_name ?? null,
      row.track_config ?? null,
      row.track_length_m ?? null,
      row.car_name ?? null,
      row.car_class ?? null,
      row.car_number ?? null,
      row.session_type ?? null,
      row.timing ?? null,
      row.total_laps ?? null,
      row.total_time_s ?? null,
      row.air_temp_c ?? null,
      row.track_temp_c ?? null,
      row.wetness_max ?? null,
      row.tier2_path ?? null,
    );
  }

  /** Sets the fields present in `patch` (and `updated_at`); an absent field is left alone. */
  updateSession(id: string, patch: SessionPatch, nowMs: number): void {
    const columns = SESSION_PATCH_COLUMNS.filter((c) => patch[c] !== undefined);
    const assignments = [...columns.map((c) => `${c} = ?`), "updated_at = ?"].join(", ");
    this.stmt(`UPDATE sessions SET ${assignments} WHERE id = ?`).run(
      ...columns.map((c) => patch[c] ?? null),
      nowMs,
      id,
    );
  }

  /** Removes a session and, through the foreign keys, its laps, stints, stops and incidents. */
  deleteSession(id: string): void {
    this.stmt("DELETE FROM sessions WHERE id = ?").run(id);
  }

  insertLap(row: NewLap, nowMs: number): void {
    this.stmt(
      `INSERT INTO laps (id, created_at, updated_at, session_id, lap_index, lap_number,
           lap_time_s, sector_times_json, fuel_valid, fuel_invalid_reason, fuel_used_l, fuel_start_l,
           fuel_end_l, energy_used, position_end, incidents_delta, pit_lap, track_temp_c,
           tyre_wear_delta, started_session_s, ended_session_s)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      nowMs,
      nowMs,
      row.session_id,
      row.lap_index,
      row.lap_number,
      row.lap_time_s,
      row.sector_times_json,
      row.fuel_valid ? 1 : 0,
      row.fuel_invalid_reason,
      row.fuel_used_l,
      row.fuel_start_l,
      row.fuel_end_l,
      row.energy_used,
      row.position_end,
      row.incidents_delta,
      row.pit_lap ? 1 : 0,
      row.track_temp_c,
      row.tyre_wear_delta,
      row.started_session_s,
      row.ended_session_s,
    );
  }

  insertStint(row: NewStint, nowMs: number): void {
    this.stmt(
      `INSERT INTO stints (id, created_at, updated_at, session_id, stint_number, start_lap,
           fuel_added_at_start_l) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      nowMs,
      nowMs,
      row.session_id,
      row.stint_number,
      row.start_lap,
      row.fuel_added_at_start_l,
    );
  }

  endStint(id: string, endLap: number, nowMs: number): void {
    this.stmt("UPDATE stints SET end_lap = ?, updated_at = ? WHERE id = ?").run(endLap, nowMs, id);
  }

  insertPitStop(row: NewPitStop, nowMs: number): void {
    this.stmt(
      `INSERT INTO pit_stops (id, created_at, updated_at, session_id, lap, entry_time_s,
           exit_time_s, stationary_s, fuel_added_l) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      nowMs,
      nowMs,
      row.session_id,
      row.lap,
      row.entry_time_s,
      row.exit_time_s,
      row.stationary_s,
      row.fuel_added_l,
    );
  }

  insertIncident(row: NewIncident, nowMs: number): void {
    this.stmt(
      `INSERT INTO incidents (id, created_at, updated_at, session_id, lap, time_s, count_delta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, nowMs, nowMs, row.session_id, row.lap, row.time_s, row.count_delta);
  }

  /**
   * Closes sessions that a crash left open, ending them at their last update. Returns how many.
   * This only completes rows the recorder itself wrote; it never deletes anything.
   */
  closeOrphans(nowMs: number): number {
    const result = this.stmt(
      `UPDATE sessions SET ended_at = updated_at, end_reason = 'crash', updated_at = ?
         WHERE ended_at IS NULL`,
    ).run(nowMs);
    return Number(result.changes);
  }
}
