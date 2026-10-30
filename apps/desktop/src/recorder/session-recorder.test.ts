import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Deriver, isUuidv7, readOtlm, type SimState } from "@overlay/sim-core";
import { SessionRecorder, type SessionRecorderOptions } from "./session-recorder";
import { SessionStore } from "./store";
import { syntheticLapTime, syntheticSession, type SyntheticOptions } from "./synthetic";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

let dir: string;
let recorder: SessionRecorder;
let store: SessionStore;
let logs: string[];
const readers: DatabaseSync[] = [];

/** A second connection to the database; closed after the test so Windows can delete the file. */
function openReader(): DatabaseSync {
  const db = new DatabaseSync(join(dir, "overlay.db"));
  readers.push(db);
  return db;
}

function setup(options: Partial<SessionRecorderOptions> = {}): void {
  logs = [];
  store = SessionStore.open(join(dir, "overlay.db"));
  recorder = new SessionRecorder(store, {
    telemetryDir: join(dir, "telemetry"),
    flushIntervalMs: 3_600_000,
    nowMs: () => NOW,
    log: (m) => logs.push(m),
    ...options,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-recorder-"));
  setup();
});

afterEach(() => {
  recorder.shutdown();
  for (const db of readers.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** Runs states through a real Deriver, as the engine does, into the recorder. */
function drive(states: Iterable<SimState>, deriver = new Deriver(), resetFirst = true): Deriver {
  if (resetFirst) deriver.reset();
  for (const state of states) {
    deriver.next(state);
    recorder.onFrame({
      source: state.source,
      state,
      sessionNum: deriver.sessionNum,
      fuelLaps: deriver.fuelTracker.lapRecords,
    });
  }
  return deriver;
}

function rows<T = Record<string, unknown>>(sql: string, db = store.db): T[] {
  return db.prepare(sql).all() as T[];
}

const race: SyntheticOptions = {
  laps: 4,
  pitOnLap: 2,
  incidentsAt: [
    [70, 2],
    [130, 1],
  ],
};

describe("one synthetic race with a pit stop and two incidents", () => {
  beforeEach(() => {
    drive(syntheticSession(race));
    recorder.shutdown();
  });

  it("writes one session row with the facts of the session and no driver names", () => {
    const db = openReader();
    const sessions = rows<Record<string, unknown>>("SELECT * FROM sessions", db);
    expect(sessions).toHaveLength(1);
    const s = sessions[0] as Record<string, unknown>;
    expect(isUuidv7(s["id"] as string)).toBe(true);
    expect(s).toMatchObject({
      sim: "iracing",
      source: "iracing",
      track_name: "Test Circuit",
      track_config: null,
      track_length_m: 5000,
      car_name: "Test GT3",
      car_class: "GT3",
      car_number: "77",
      session_type: "race",
      timing: "laps",
      total_laps: 4,
      started_at: NOW,
      ended_at: NOW,
      end_reason: "stop",
      created_at: NOW,
      updated_at: NOW,
      air_temp_c: 22,
      track_temp_c: 31,
      wetness_max: 0,
    });
    expect(s["tier2_path"]).toMatch(/^iracing\/2026-10\/[0-9a-f-]{36}\.otlm$/);
  });

  it("writes a lap row per fuel record with times, fuel, position, pit flag and incidents", () => {
    const db = openReader();
    const laps = rows<Record<string, number | string | null>>(
      "SELECT * FROM laps ORDER BY lap_number",
      db,
    );
    expect(laps.map((l) => l["lap_number"])).toEqual([1, 2, 3, 4]);
    expect(laps.map((l) => l["fuel_valid"])).toEqual([1, 1, 0, 1]);
    expect(laps.map((l) => l["fuel_invalid_reason"])).toEqual([null, null, "outlap", null]);
    expect(laps.map((l) => l["pit_lap"])).toEqual([0, 1, 1, 0]);
    // 70 s into lap 2 the first incident (2 points); lap 3 gets the second (1 point).
    expect(laps.map((l) => l["incidents_delta"])).toEqual([0, 2, 1, 0]);
    laps.forEach((lap, i) => {
      expect(lap["lap_time_s"]).toBeCloseTo(syntheticLapTime(i + 1, race), 6);
      expect(isUuidv7(lap["id"] as string)).toBe(true);
      expect(lap["position_end"]).toBe(3);
      expect(lap["track_temp_c"]).toBe(31);
      expect(lap["sector_times_json"]).toBeNull();
      expect(lap["energy_used"]).toBeNull();
      expect(lap["tyre_wear_delta"]).toBeNull();
    });
    expect(laps[0]?.["fuel_used_l"]).toBeCloseTo(2, 6);
    expect(laps[0]?.["fuel_start_l"]).toBeCloseTo(40, 6);
    expect(laps[0]?.["fuel_end_l"]).toBeCloseTo(38, 6);
  });

  it("writes the pit stop, two stints and the incidents", () => {
    const db = openReader();
    const stops = rows<Record<string, number>>("SELECT * FROM pit_stops", db);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ lap: 2 });
    expect(stops[0]?.["stationary_s"]).toBeCloseTo(5.9, 0);
    expect(stops[0]?.["fuel_added_l"]).toBeCloseTo(30, 0);
    expect(stops[0]?.["exit_time_s"] as number).toBeGreaterThan(
      stops[0]?.["entry_time_s"] as number,
    );

    const stints = rows<Record<string, number | null>>(
      "SELECT * FROM stints ORDER BY stint_number",
      db,
    );
    expect(stints).toHaveLength(2);
    expect(stints[0]).toMatchObject({ stint_number: 1, start_lap: 1, end_lap: 2 });
    expect(stints[0]?.["fuel_added_at_start_l"]).toBeNull();
    expect(stints[1]).toMatchObject({ stint_number: 2, start_lap: 3, end_lap: 5 });
    expect(stints[1]?.["fuel_added_at_start_l"]).toBeCloseTo(30, 0);

    const incidents = rows<Record<string, number>>("SELECT * FROM incidents ORDER BY time_s", db);
    expect(incidents.map((i) => [i["lap"], i["count_delta"]])).toEqual([
      [2, 2],
      [3, 1],
    ]);
  });

  it("stores nothing that names a driver", () => {
    const text = readFileSync(join(dir, "overlay.db"));
    expect(text.includes("Alice Example")).toBe(false);
  });
});

describe("tier 2 file of a session", () => {
  it("holds the player's channels and the field, and is listed in the month manifest", () => {
    drive(syntheticSession({ ...race, otherDriverName: "Alice Example" }));
    recorder.shutdown();
    const [session] = rows<{ id: string; tier2_path: string }>(
      "SELECT id, tier2_path FROM sessions",
      openReader(),
    );
    const path = join(dir, "telemetry", ...(session?.tier2_path ?? "").split("/"));
    const bytes = readFileSync(path);
    const file = readOtlm(bytes);
    expect(file.complete).toBe(true);
    expect(file.header.sessionId).toBe(session?.id);
    expect(file.header.groups.map((g) => g.id)).toEqual(["player", "field"]);
    const player = file.groups["player"];
    expect(player?.samples).toBeGreaterThan(2000); // 10 Hz synthetic ticks over 252 s
    expect(player?.channels["rpm"]?.[10]).toBe(7000);
    expect(player?.channels["gear"]?.[10]).toBe(4);
    expect(player?.channels["throttle"]?.[10]).toBeCloseTo(0.8, 3);
    expect(player?.channels["fuel"]?.[0]).toBeCloseTo(40, 3);
    expect(player?.channels["lap"]?.[player.samples - 1]).toBe(4);
    const field = file.groups["field"];
    expect(field?.samples).toBeGreaterThan(900 / 4 / 4);
    expect(field?.channels["position"]?.[0]).toBe(3); // carIdx 0
    expect(field?.channels["position"]?.[1]).toBe(2); // carIdx 1
    expect(field?.channels["position"]?.[2]).toBe(0); // no such car
    expect(bytes.includes(Buffer.from("Alice Example"))).toBe(false);

    const manifest = JSON.parse(
      readFileSync(join(dir, "telemetry", "iracing", "2026-10", "manifest.json"), "utf8"),
    ) as { files: { file: string; bytes: number }[] };
    expect(manifest.files).toEqual([
      { file: `${session?.id}.otlm`, bytes: bytes.length, modifiedAt: expect.any(Number) },
    ]);
  });

  it("can be turned off", () => {
    recorder.shutdown();
    setup({ telemetryDir: null });
    drive(syntheticSession({ laps: 2 }));
    recorder.shutdown();
    expect(existsSync(join(dir, "telemetry"))).toBe(false);
    expect(rows("SELECT tier2_path FROM sessions", openReader())).toEqual([
      expect.objectContaining({ tier2_path: null }),
    ]);
  });
});

describe("lap times", () => {
  it("fall back to the crossing times when the sim reports none", () => {
    drive(syntheticSession({ laps: 3, reportLastLap: false }));
    recorder.shutdown();
    const laps = rows<{ lap_number: number; lap_time_s: number | null }>(
      "SELECT lap_number, lap_time_s FROM laps ORDER BY lap_number",
      openReader(),
    );
    expect(laps.map((l) => l.lap_number)).toEqual([1, 2, 3]);
    // Lap 1 began when the session was joined, so it has no crossing time.
    expect(laps[0]?.lap_time_s).toBeNull();
    expect(laps[1]?.lap_time_s).toBeCloseTo(60, 6);
    expect(laps[2]?.lap_time_s).toBeCloseTo(60, 6);
  });
});

describe("sessions", () => {
  it("opens a new session when the Deriver starts a new one", () => {
    const deriver = drive(syntheticSession({ laps: 2, sessionType: "practice" }));
    drive(syntheticSession({ laps: 2, sessionType: "race", startS: 5000 }), deriver, false);
    recorder.shutdown();
    const db = openReader();
    const sessions = rows<{ id: string; session_type: string; end_reason: string }>(
      "SELECT id, session_type, end_reason FROM sessions ORDER BY started_at, id",
      db,
    );
    expect(sessions.map((s) => s.session_type).sort()).toEqual(["practice", "race"]);
    expect(sessions.map((s) => s.end_reason).sort()).toEqual(["sessionChange", "stop"]);
    for (const s of sessions) {
      const laps = rows<{ n: number }>(
        `SELECT COUNT(*) AS n FROM laps WHERE session_id = '${s.id}'`,
        db,
      );
      expect(laps[0]?.n).toBe(2);
    }
    expect(
      readdirSync(join(dir, "telemetry", "iracing", "2026-10")).filter((f) => f.endsWith(".otlm")),
    ).toHaveLength(2);
  });

  it("ends the open session when the engine says the source ended", () => {
    drive(syntheticSession({ laps: 2 }));
    expect(recorder.activeSessionId).not.toBeNull();
    recorder.end("sourceSwitch");
    expect(recorder.activeSessionId).toBeNull();
    const [row] = rows<{ end_reason: string }>("SELECT end_reason FROM sessions");
    expect(row?.end_reason).toBe("sourceSwitch");
  });

  it("drops a connection flicker that holds no laps and only seconds of data", () => {
    drive(syntheticSession({ laps: 0, tailS: 3 }));
    recorder.end("sourceSwitch");
    expect(rows("SELECT id FROM sessions")).toEqual([]);
    expect(existsSync(join(dir, "telemetry", "iracing"))).toBe(true);
    expect(
      readdirSync(join(dir, "telemetry", "iracing", "2026-10")).filter((f) => f.endsWith(".otlm")),
    ).toEqual([]);
  });

  it("does not record replay or mock unless the debug flag is on", () => {
    drive(syntheticSession({ laps: 2, source: "replay" }));
    drive(syntheticSession({ laps: 2, source: "mock" }));
    recorder.end("stop");
    expect(rows("SELECT id FROM sessions")).toEqual([]);
    expect(existsSync(join(dir, "telemetry"))).toBe(false);
  });

  it("records a replay when the debug flag is on, and says so", () => {
    recorder.shutdown();
    setup({ recordSynthetic: true });
    drive(syntheticSession({ laps: 2, source: "replay" }));
    recorder.end("stop");
    const sessions = rows<{ sim: string; source: string }>("SELECT sim, source FROM sessions");
    // A replay of this synthetic state has incident counts, which only iRacing has.
    expect(sessions).toEqual([{ sim: "iracing", source: "replay" }]);
  });

  it("does not rewrite laps the tracker had before the session opened", () => {
    const deriver = drive(syntheticSession({ laps: 3 }));
    recorder.end("sourceSwitch");
    const before = rows<{ n: number }>("SELECT COUNT(*) AS n FROM laps")[0]?.n;
    expect(before).toBe(3);
    // The same sim comes back after a pause; the Deriver (and its tracker) kept its history.
    const next = [...syntheticSession({ laps: 1, startS: 2000 })];
    for (const state of next) {
      deriver.next(state);
      recorder.onFrame({
        source: "iracing",
        state,
        sessionNum: deriver.sessionNum,
        fuelLaps: deriver.fuelTracker.lapRecords,
      });
    }
    recorder.end("stop");
    expect(rows<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")[0]?.n).toBe(2);
    // The tracker started over when the lap counter went back; the first session keeps its laps.
    expect(rows<{ n: number }>("SELECT COUNT(*) AS n FROM laps")[0]?.n).toBe(4);
  });
});

describe("crash tolerance", () => {
  it("leaves committed rows and a readable tier 2 file when the process dies mid-session", () => {
    // 100 s into the race, flush as the timer would, then "crash": no shutdown, no footer.
    const states = [...syntheticSession({ laps: 4 })].slice(0, 1000);
    drive(states);
    recorder.flush();
    // An independent connection, as the next start would have.
    const db = openReader();
    const [session] = rows<{ id: string; ended_at: number | null; tier2_path: string }>(
      "SELECT id, ended_at, tier2_path FROM sessions",
      db,
    );
    expect(session?.ended_at).toBeNull();
    expect(rows("SELECT lap_number FROM laps", db)).toHaveLength(1);

    const reopened = SessionStore.open(join(dir, "overlay.db"));
    expect(reopened.closeOrphans(NOW + 1000)).toBe(1);
    const [closed] = rows<{ ended_at: number; end_reason: string }>(
      "SELECT ended_at, end_reason FROM sessions",
      reopened.db,
    );
    expect(closed).toEqual({ ended_at: NOW, end_reason: "crash" });
    reopened.close();

    // No chunk was full yet at 10 Hz x 100 s... 600 samples is a chunk: it was flushed.
    const file = readOtlm(
      readFileSync(join(dir, "telemetry", ...(session?.tier2_path ?? "").split("/"))),
    );
    expect(file.complete).toBe(false);
    expect(file.groups["player"]?.samples).toBe(600);
  });
});

describe("failures", () => {
  it("never throw into the engine, and stop recording after repeated errors", () => {
    store.db.exec("PRAGMA foreign_keys = OFF");
    store.db.exec("DROP TABLE sessions");
    const states = [...syntheticSession({ laps: 1 })];
    expect(() => {
      const deriver = new Deriver();
      deriver.reset();
      // Frames keep succeeding between the failing flushes; that must not hide the failures.
      for (let i = 0; i < 6; i++) {
        drive(states.slice(i * 50, (i + 1) * 50), deriver, false);
        recorder.flush();
      }
    }).not.toThrow();
    expect(logs.join("\n")).toMatch(/no such table/);
    expect(logs.join("\n")).toMatch(/too many errors/);
    // Disabled: later frames are ignored without further errors.
    const count = logs.length;
    drive(syntheticSession({ laps: 1, startS: 9000 }));
    recorder.flush();
    expect(logs.length).toBe(count);
  });
});
