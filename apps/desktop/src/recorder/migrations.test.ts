import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { currentVersion, MIGRATIONS, migrate, type Migration } from "./migrations";
import { openDatabase, SessionStore } from "./store";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tables(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  )
    .map((r) => r.name)
    .sort();
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe("migrations", () => {
  it("builds the whole schema from an empty database and records the version", () => {
    const db = new DatabaseSync(":memory:");
    expect(currentVersion(db)).toBe(0);
    expect(migrate(db, MIGRATIONS, 123)).toBe(2);
    expect(tables(db)).toEqual([
      "incidents",
      "laps",
      "pit_stops",
      "schema_version",
      "sessions",
      "stints",
    ]);
    expect(db.prepare("SELECT version, name, applied_at FROM schema_version").all()).toEqual([
      { version: 1, name: "initial", applied_at: 123 },
      { version: 2, name: "lap_index", applied_at: 123 },
    ]);
  });

  it("gives every table a UUID-style text id and created/updated stamps", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    for (const table of ["sessions", "laps", "stints", "pit_stops", "incidents"]) {
      const cols = columns(db, table);
      expect(cols.slice(0, 3)).toEqual(["id", "created_at", "updated_at"]);
    }
    const info = db.prepare("PRAGMA table_info(laps)").all() as { name: string; type: string }[];
    expect(info.find((c) => c.name === "id")?.type).toBe("TEXT");
  });

  it("has the columns the ticket asks for", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    expect(columns(db, "sessions")).toEqual(
      expect.arrayContaining([
        "sim",
        "track_name",
        "track_config",
        "track_length_m",
        "car_name",
        "car_class",
        "session_type",
        "started_at",
        "ended_at",
        "timing",
        "total_laps",
        "total_time_s",
      ]),
    );
    expect(columns(db, "laps")).toEqual(
      expect.arrayContaining([
        "session_id",
        "lap_index",
        "lap_number",
        "lap_time_s",
        "sector_times_json",
        "fuel_valid",
        "fuel_invalid_reason",
        "fuel_used_l",
        "fuel_start_l",
        "fuel_end_l",
        "energy_used",
        "position_end",
        "incidents_delta",
        "pit_lap",
        "track_temp_c",
        "tyre_wear_delta",
      ]),
    );
    expect(columns(db, "stints")).toEqual(
      expect.arrayContaining(["start_lap", "end_lap", "fuel_added_at_start_l"]),
    );
    expect(columns(db, "pit_stops")).toEqual(
      expect.arrayContaining([
        "lap",
        "entry_time_s",
        "exit_time_s",
        "stationary_s",
        "fuel_added_l",
      ]),
    );
    expect(columns(db, "incidents")).toEqual(
      expect.arrayContaining(["lap", "time_s", "count_delta"]),
    );
  });

  it("upgrades a version 1 database: lap_index is filled in insertion order", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, MIGRATIONS.slice(0, 1));
    db.exec("PRAGMA foreign_keys = OFF");
    for (const [id, session, lap] of [
      ["a", "s1", 1],
      ["b", "s1", 2],
      ["c", "s1", 1],
      ["d", "s2", 5],
    ] as const) {
      db.prepare(
        `INSERT INTO laps (id, created_at, updated_at, session_id, lap_number, fuel_valid, pit_lap)
         VALUES (?, 0, 0, ?, ?, 1, 0)`,
      ).run(id, session, lap);
    }
    expect(migrate(db)).toBe(2);
    expect(db.prepare("SELECT id, lap_index FROM laps ORDER BY id").all()).toEqual([
      { id: "a", lap_index: 1 },
      { id: "b", lap_index: 2 },
      { id: "c", lap_index: 3 },
      { id: "d", lap_index: 1 },
    ]);
  });

  it("is idempotent: running again changes nothing", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    migrate(db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_version").get()).toEqual({ n: 2 });
  });

  it("applies only the migrations that are missing", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    const second: Migration = {
      version: 3,
      name: "add_note",
      sql: "ALTER TABLE sessions ADD COLUMN note TEXT",
    };
    expect(migrate(db, [...MIGRATIONS, second])).toBe(3);
    expect(columns(db, "sessions")).toContain("note");
    expect(currentVersion(db)).toBe(3);
  });

  it("rolls a failing migration back completely and leaves the version alone", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    const broken: Migration = {
      version: 3,
      name: "broken",
      sql: "CREATE TABLE half (id TEXT); INSERT INTO nowhere VALUES (1);",
    };
    expect(() => migrate(db, [...MIGRATIONS, broken])).toThrow();
    expect(currentVersion(db)).toBe(2);
    expect(tables(db)).not.toContain("half");
  });

  it("refuses a database written by a newer app", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, [...MIGRATIONS, { version: 5, name: "future", sql: "SELECT 1" }]);
    expect(() => migrate(db)).toThrow(/newer than this app/);
  });
});

describe("openDatabase", () => {
  it("uses WAL on disk, enforces foreign keys and keeps data across opens", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-db-"));
    dirs.push(dir);
    const path = join(dir, "nested", "overlay.db");
    const store = SessionStore.open(path);
    expect(store.db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(store.db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(() =>
      store.insertIncident(
        { id: "i", session_id: "missing", lap: 1, time_s: 1, count_delta: 1 },
        1,
      ),
    ).toThrow(/FOREIGN KEY/);
    store.insertSession({ id: "s", sim: "iracing", source: "iracing", started_at: 5 }, 5);
    store.close();

    const again = openDatabase(path);
    expect(again.prepare("SELECT id, started_at FROM sessions").all()).toEqual([
      { id: "s", started_at: 5 },
    ]);
    again.close();
  });

  it("deleting a session removes its rows", () => {
    const store = SessionStore.open(":memory:");
    store.insertSession({ id: "s", sim: "lmu", source: "lmu", started_at: 1 }, 1);
    store.insertIncident({ id: "i", session_id: "s", lap: 1, time_s: 1, count_delta: 1 }, 1);
    store.deleteSession("s");
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM incidents").get()).toEqual({ n: 0 });
    store.close();
  });

  it("updates only the fields given and stamps updated_at", () => {
    const store = SessionStore.open(":memory:");
    store.insertSession(
      {
        id: "s",
        sim: "lmu",
        source: "lmu",
        started_at: 1,
        track_name: "Le Mans",
        car_name: "499P",
      },
      10,
    );
    store.updateSession("s", { car_name: null, total_laps: 7 }, 20);
    expect(
      store.db
        .prepare("SELECT track_name, car_name, total_laps, created_at, updated_at FROM sessions")
        .get(),
    ).toEqual({
      track_name: "Le Mans",
      car_name: null,
      total_laps: 7,
      created_at: 10,
      updated_at: 20,
    });
    store.close();
  });
});
