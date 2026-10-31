import type { DatabaseSync } from "node:sqlite";

/**
 * Tier 1 schema. Rules for Release 2, which uploads these rows: every row has a UUIDv7 `id`
 * made locally and `created_at` / `updated_at` in Unix milliseconds; rows are never renumbered.
 * Only the player's own car is recorded, and no driver names: a car is its number and position.
 *
 * Lap numbers are the fuel tracker's: the completed-lap counter after the lap ended, so lap 0 is
 * the out or formation lap and the first racing lap is lap 1.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const V1 = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sim TEXT NOT NULL,
  source TEXT NOT NULL,
  track_name TEXT,
  track_config TEXT,
  track_length_m REAL,
  car_name TEXT,
  car_class TEXT,
  car_number TEXT,
  session_type TEXT,
  timing TEXT,
  total_laps INTEGER,
  total_time_s REAL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT,
  air_temp_c REAL,
  track_temp_c REAL,
  wetness_max REAL,
  tier2_path TEXT
);
CREATE INDEX sessions_started_at ON sessions (started_at);

CREATE TABLE laps (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  lap_number INTEGER NOT NULL,
  lap_time_s REAL,
  sector_times_json TEXT,
  fuel_valid INTEGER NOT NULL,
  fuel_invalid_reason TEXT,
  fuel_used_l REAL,
  fuel_start_l REAL,
  fuel_end_l REAL,
  energy_used REAL,
  position_end INTEGER,
  incidents_delta INTEGER,
  pit_lap INTEGER NOT NULL,
  track_temp_c REAL,
  tyre_wear_delta REAL,
  started_session_s REAL,
  ended_session_s REAL
);
CREATE INDEX laps_session ON laps (session_id, lap_number);

CREATE TABLE stints (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  stint_number INTEGER NOT NULL,
  start_lap INTEGER NOT NULL,
  end_lap INTEGER,
  fuel_added_at_start_l REAL
);
CREATE INDEX stints_session ON stints (session_id, stint_number);

CREATE TABLE pit_stops (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  lap INTEGER NOT NULL,
  entry_time_s REAL,
  exit_time_s REAL,
  stationary_s REAL NOT NULL,
  fuel_added_l REAL NOT NULL
);
CREATE INDEX pit_stops_session ON pit_stops (session_id, lap);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  lap INTEGER NOT NULL,
  time_s REAL,
  count_delta INTEGER NOT NULL
);
CREATE INDEX incidents_session ON incidents (session_id, lap);
`;

// Lap numbers repeat after a lap counter reset, so rows also carry their order of insertion.
const V2 = `
ALTER TABLE laps ADD COLUMN lap_index INTEGER NOT NULL DEFAULT 0;
UPDATE laps SET lap_index = (
  SELECT COUNT(*) FROM laps AS earlier
  WHERE earlier.session_id = laps.session_id AND earlier.rowid <= laps.rowid
);
CREATE INDEX laps_session_index ON laps (session_id, lap_index);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "initial", sql: V1 },
  { version: 2, name: "lap_index", sql: V2 },
];

const SCHEMA_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

/** The highest migration applied, 0 for an empty database. */
export function currentVersion(db: DatabaseSync): number {
  db.exec(SCHEMA_VERSION_TABLE);
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as {
    v: number | null;
  };
  return row.v ?? 0;
}

/**
 * Applies the migrations that are missing, each in its own transaction, and returns the version
 * reached. A database from a newer app is refused rather than guessed at.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
  nowMs: number = Date.now(),
): number {
  const have = currentVersion(db);
  const latest = migrations.reduce((m, x) => Math.max(m, x.version), 0);
  if (have > latest) {
    throw new Error(`Database schema ${have} is newer than this app understands (${latest})`);
  }
  const pending = migrations.filter((m) => m.version > have).sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        nowMs,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return latest;
}
