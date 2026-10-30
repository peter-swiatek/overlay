import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { readOtlm, type FixtureRecord } from "@overlay/sim-core";
import { SessionRecorder } from "../recorder/session-recorder";
import { SessionStore } from "../recorder/store";
import { TelemetryEngine } from "./engine";
import { ReplayTelemetrySource } from "./replay";
import { IRACING_RACE_START, IRACING_SESSION_CHANGE, LMU_ON_PACE, readRecords } from "./testing";

const dirs: string[] = [];
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 });
});

interface Outcome {
  dir: string;
  db: DatabaseSync;
  sessions: Record<string, unknown>[];
  laps: (Record<string, unknown> & { session_id: string })[];
  logs: string[];
}

/** Plays a replay through a real engine with a real recorder, as fast as it will go. */
async function runReplay(
  source: () => ReplayTelemetrySource,
  recordSynthetic: boolean,
): Promise<Outcome> {
  const dir = mkdtempSync(join(tmpdir(), "overlay-engine-rec-"));
  dirs.push(dir);
  const logs: string[] = [];
  const store = SessionStore.open(join(dir, "overlay.db"));
  const recorder = new SessionRecorder(store, {
    telemetryDir: join(dir, "telemetry"),
    recordSynthetic,
    minSessionS: 0,
    flushIntervalMs: 500,
    log: (m) => logs.push(m),
  });
  let live = false;
  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));
  const engine = new TelemetryEngine({
    live: {},
    createReplay: () => source(),
    createMock: () => {
      throw new Error("no mock");
    },
    publish: () => {},
    onStatus: (status) => {
      if (status === "live") live = true;
      else if (status === "waiting" && live) finished();
    },
    recorder,
  });
  engine.start();
  engine.setSource({ source: "replay", replayPath: "unused", replaySpeed: 0, replayLoop: false });
  await done;
  engine.stop();
  recorder.shutdown();
  const db = new DatabaseSync(join(dir, "overlay.db"));
  databases.push(db);
  return {
    dir,
    db,
    sessions: db.prepare("SELECT * FROM sessions ORDER BY started_at, id").all() as Record<
      string,
      unknown
    >[],
    laps: db.prepare("SELECT * FROM laps ORDER BY session_id, lap_number").all() as Outcome["laps"],
    logs,
  };
}

const fromFile = (path: string) => () =>
  ReplayTelemetrySource.fromFile(path, { speed: 0, loop: false });

// Full replays through a real engine and SQLite take several seconds, longer on Windows runners.
describe("telemetry engine with the recorder", { timeout: 60_000 }, () => {
  it("does not record a replay unless the debug flag is set", async () => {
    const out = await runReplay(fromFile(IRACING_RACE_START), false);
    expect(out.sessions).toEqual([]);
    expect(readdirSync(out.dir)).not.toContain("telemetry");
  });

  it("records a replay of the race start as one session, with tier 2 data", async () => {
    const out = await runReplay(fromFile(IRACING_RACE_START), true);
    expect(out.logs).toEqual([]);
    expect(out.sessions).toHaveLength(1);
    const session = out.sessions[0] as Record<string, string | number>;
    expect(session).toMatchObject({
      sim: "iracing",
      source: "replay",
      session_type: "race",
      end_reason: "sourceSwitch",
    });
    expect(String(session["track_name"]).length).toBeGreaterThan(0);
    expect(String(session["car_name"]).length).toBeGreaterThan(0);
    // The 20 s slice holds the parade lap's end and the first S/F crossing of the race.
    expect(out.laps.length).toBeGreaterThanOrEqual(1);
    const file = readOtlm(
      readFileSync(join(out.dir, "telemetry", ...String(session["tier2_path"]).split("/"))),
    );
    expect(file.complete).toBe(true);
    expect(file.groups["player"]?.samples).toBeGreaterThan(900);
    expect(file.groups["field"]?.samples).toBeGreaterThan(70);
  });

  it("opens a second session when the sim moves from qualifying to the race", async () => {
    const out = await runReplay(fromFile(IRACING_SESSION_CHANGE), true);
    expect(out.sessions.map((s) => s["session_type"])).toEqual(["qualifying", "race"]);
    expect(out.sessions.map((s) => s["end_reason"])).toEqual(["sessionChange", "sourceSwitch"]);
  });

  it("records an LMU replay under the lmu sim", async () => {
    const out = await runReplay(fromFile(LMU_ON_PACE), true);
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]).toMatchObject({ sim: "lmu", source: "replay" });
  });

  it("restarting a looped replay starts a new session", async () => {
    const records: FixtureRecord[] = await readRecords(IRACING_RACE_START);
    // The same records twice: the second header is a restart.
    const out = await runReplay(
      () => ReplayTelemetrySource.fromRecords([...records, ...records]),
      true,
    );
    expect(out.sessions).toHaveLength(2);
  });
});

/**
 * Local only: the whole 12-lap race recording through the engine with the recorder, to count
 * what is stored. OVERLAY_IRACING_RECORDING is the file from the Ferrari/Corvette weekend (or the
 * other iRacing recording); cars are referred to by carIdx only.
 */
const recording = process.env["OVERLAY_IRACING_RECORDING"];

describe("local iRacing recording through the engine and the recorder", () => {
  it.skipIf(!recording)(
    "gives one session per sim session with the expected lap rows",
    async () => {
      const out = await runReplay(fromFile(recording as string), true);
      const summary = out.sessions.map((s) => {
        const laps = out.laps.filter((l) => l.session_id === s["id"]);
        const reasons = laps.map((l) =>
          l["fuel_valid"] === 1 ? "valid" : String(l["fuel_invalid_reason"]),
        );
        const counts: Record<string, number> = {};
        for (const r of reasons) counts[r] = (counts[r] ?? 0) + 1;
        const bytes = readFileSync(
          join(out.dir, "telemetry", ...String(s["tier2_path"]).split("/")),
        );
        const file = readOtlm(bytes);
        return {
          type: s["session_type"],
          end: s["end_reason"],
          laps: laps.length,
          counts,
          times: laps.map((l) =>
            typeof l["lap_time_s"] === "number" ? l["lap_time_s"].toFixed(3) : "null",
          ),
          stops: out.db
            .prepare("SELECT COUNT(*) AS n FROM pit_stops WHERE session_id = ?")
            .get(String(s["id"])),
          incidents: out.db
            .prepare("SELECT COUNT(*) AS n FROM incidents WHERE session_id = ?")
            .get(String(s["id"])),
          stints: out.db
            .prepare("SELECT COUNT(*) AS n FROM stints WHERE session_id = ?")
            .get(String(s["id"])),
          tier2Bytes: bytes.length,
          playerSamples: file.groups["player"]?.samples,
          fieldSamples: file.groups["field"]?.samples,
          complete: file.complete,
        };
      });
      console.log(JSON.stringify({ sessions: summary, logs: out.logs }, null, 1));
      expect(out.logs).toEqual([]);
      const race = out.sessions.findIndex((s) => s["session_type"] === "race");
      expect(race).toBeGreaterThanOrEqual(0);
      const raceLaps = out.laps.filter((l) => l.session_id === out.sessions[race]?.["id"]);
      const reasons = raceLaps.map((l) =>
        l["fuel_valid"] === 1 ? "valid" : String(l["fuel_invalid_reason"]),
      );
      // One pace lap, 12 valid laps and the cooldown lap; resets after the flag are not laps.
      expect(reasons.filter((r) => r === "valid")).toHaveLength(12);
      expect(reasons.filter((r) => r === "paceLap")).toHaveLength(1);
      expect(reasons.filter((r) => r === "cooldown")).toHaveLength(1);
      expect(reasons).toHaveLength(14);
      for (const lap of raceLaps.filter((l) => l["fuel_valid"] === 1)) {
        expect(lap["lap_time_s"] as number).toBeGreaterThan(60);
        expect(lap["lap_time_s"] as number).toBeLessThan(200);
      }
    },
    600_000,
  );
});
