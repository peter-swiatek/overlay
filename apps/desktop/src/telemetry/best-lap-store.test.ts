import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAP_TRACE_BINS, type LapTrace } from "@overlay/sim-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BEST_LAPS_MAX_KEYS,
  FileBestLapStore,
  bestLapFile,
  parseBestLapFile,
} from "./best-lap-store";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "overlay-best-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KEY = "iracing|mazda-mx-5-cup|iracing_lime-rock_full";

/** A valid trace for a lap of `lapTimeS` seconds. */
function trace(lapTimeS = 90, speed = 40): LapTrace {
  return {
    timeS: Array.from(
      { length: LAP_TRACE_BINS },
      (_, k) => Math.round((k / LAP_TRACE_BINS) * lapTimeS * 1000) / 1000,
    ),
    speedMps: Array.from({ length: LAP_TRACE_BINS }, () => speed),
  };
}

describe("FileBestLapStore", () => {
  it("keeps laps in userData/best-laps.json and reads them back after a restart", async () => {
    const userData = tempDir();
    const file = bestLapFile(userData);
    expect(file).toBe(join(userData, "best-laps.json"));
    const store = new FileBestLapStore(file);
    expect(store.load(KEY)).toBeNull();
    store.record(KEY, { lapTimeS: 90.5, trace: trace(90.5) });
    expect(store.load(KEY)?.lapTimeS).toBe(90.5);
    await store.idle();
    expect(readdirSync(userData)).toEqual(["best-laps.json"]);

    const again = new FileBestLapStore(file);
    expect(again.load(KEY)).toEqual({ lapTimeS: 90.5, trace: trace(90.5) });
  });

  it("replaces with a faster lap and ignores a slower or equal one", () => {
    const store = new FileBestLapStore(join(tempDir(), "b.json"));
    store.record(KEY, { lapTimeS: 90, trace: null });
    store.record(KEY, { lapTimeS: 91, trace: null });
    expect(store.load(KEY)?.lapTimeS).toBe(90);
    store.record(KEY, { lapTimeS: 90.0003, trace: null });
    store.record(KEY, { lapTimeS: 89.9997, trace: null });
    expect(store.load(KEY)?.lapTimeS).toBe(90);
    store.record(KEY, { lapTimeS: 89.5, trace: null });
    expect(store.load(KEY)?.lapTimeS).toBe(89.5);
  });

  it("lets a traced lap replace an equal trace-less one, but not the other way round", () => {
    const store = new FileBestLapStore(join(tempDir(), "b.json"));
    store.record(KEY, { lapTimeS: 90, trace: null });
    store.record(KEY, { lapTimeS: 90, trace: trace(90) });
    expect(store.load(KEY)?.trace).not.toBeNull();
    store.record(KEY, { lapTimeS: 90, trace: null });
    expect(store.load(KEY)?.trace).not.toBeNull();
  });

  it("drops junk entries and bad traces when reading", () => {
    const userData = tempDir();
    const file = bestLapFile(userData);
    const badStart = trace(90);
    badStart.timeS[0] = 0.5;
    const decreasing = trace(90);
    decreasing.timeS[10] = 0;
    const tooLong = trace(95);
    const short = { timeS: [0, 1], speedMps: [1, 1] };
    const entry = (lapTimeS: unknown, t: unknown) => ({ lapTimeS, trace: t, updatedAt: "x" });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        entries: {
          good: entry(90, trace(90)),
          zero: entry(0, null),
          text: entry("90", null),
          nope: "junk",
          badStart: entry(90, badStart),
          decreasing: entry(90, decreasing),
          tooLong: entry(90, tooLong),
          short: entry(90, short),
        },
      }),
      "utf8",
    );
    const store = new FileBestLapStore(file);
    expect(store.load("good")?.trace).not.toBeNull();
    for (const key of ["badStart", "decreasing", "tooLong", "short"]) {
      expect(store.load(key)?.lapTimeS).toBe(90);
      expect(store.load(key)?.trace).toBeNull();
    }
    for (const key of ["zero", "text", "nope"]) expect(store.load(key)).toBeNull();
    expect(parseBestLapFile(42)).toEqual({ version: 1, entries: {} });
  });

  it("starts empty on a corrupt file and moves it aside", () => {
    const userData = tempDir();
    const file = bestLapFile(userData);
    writeFileSync(file, "{not json", "utf8");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(new FileBestLapStore(file).load(KEY)).toBeNull();
    expect(readdirSync(userData).some((f) => f.includes(".bad-"))).toBe(true);
    vi.restoreAllMocks();
  });

  it("evicts the oldest entries beyond the cap", async () => {
    const userData = tempDir();
    const file = bestLapFile(userData);
    let tick = 0;
    const store = new FileBestLapStore(
      file,
      undefined,
      () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    );
    for (let i = 0; i < BEST_LAPS_MAX_KEYS + 3; i++) {
      store.record(`k${i}`, { lapTimeS: 90, trace: null });
    }
    await store.idle();
    const saved = JSON.parse(readFileSync(file, "utf8")) as { entries: Record<string, unknown> };
    expect(Object.keys(saved.entries)).toHaveLength(BEST_LAPS_MAX_KEYS);
    expect(saved.entries["k0"]).toBeUndefined();
    expect(saved.entries["k2"]).toBeUndefined();
    expect(saved.entries["k3"]).toBeDefined();
    expect(saved.entries[`k${BEST_LAPS_MAX_KEYS + 2}`]).toBeDefined();
  });

  it("reports a write failure to onError and later records still work", async () => {
    const userData = tempDir();
    // The parent of the file is a regular file, so the folder cannot be created.
    const blocker = join(userData, "blocker");
    writeFileSync(blocker, "x", "utf8");
    const onError = vi.fn();
    const store = new FileBestLapStore(join(blocker, "best-laps.json"), onError);
    expect(() => store.record(KEY, { lapTimeS: 90, trace: null })).not.toThrow();
    await store.idle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).not.toContain("mazda");
    store.record(KEY, { lapTimeS: 89, trace: null });
    await store.idle();
    expect(store.load(KEY)?.lapTimeS).toBe(89);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("rounds times to 0.001 s and speeds to 0.01 m/s", () => {
    const store = new FileBestLapStore(join(tempDir(), "b.json"));
    const t = trace(90.12349, 41.23456);
    t.timeS[1] = 0.22222;
    store.record(KEY, { lapTimeS: 90.12349, trace: t });
    const got = store.load(KEY);
    expect(got?.lapTimeS).toBe(90.123);
    expect(got?.trace?.timeS[1]).toBe(0.222);
    expect(got?.trace?.speedMps[0]).toBe(41.23);
  });
});
