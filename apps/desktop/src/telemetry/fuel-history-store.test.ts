import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileFuelHistoryStore, fuelHistoryFile } from "./fuel-history-store";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "overlay-fuel-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KEY = "fuel|iracing|mazda-mx-5-cup|iracing_lime-rock_full";

describe("FileFuelHistoryStore", () => {
  it("keeps laps in userData/fuel-history.json and reads them back after a restart", async () => {
    const userData = tempDir();
    const file = fuelHistoryFile(userData);
    expect(file).toBe(join(userData, "fuel-history.json"));
    const store = new FileFuelHistoryStore(file);
    expect(store.load(KEY)).toEqual([]);
    store.record(KEY, { used: 2.5, lapTimeS: 91.2 });
    store.record(KEY, { used: 2.6, lapTimeS: null });
    expect(store.load(KEY)).toHaveLength(2);
    await store.idle();
    expect(readdirSync(userData)).toEqual(["fuel-history.json"]);

    const again = new FileFuelHistoryStore(file);
    expect(again.load(KEY)).toEqual([
      { used: 2.5, lapTimeS: 91.2 },
      { used: 2.6, lapTimeS: null },
    ]);
  });

  it("coalesces writes: the latest content wins", async () => {
    const userData = tempDir();
    const file = fuelHistoryFile(userData);
    const store = new FileFuelHistoryStore(file);
    for (let i = 0; i < 25; i++) store.record(KEY, { used: 1 + i / 10, lapTimeS: null });
    await store.idle();
    const saved = JSON.parse(readFileSync(file, "utf8")) as {
      entries: Record<string, { laps: unknown[] }>;
    };
    expect(saved.entries[KEY]?.laps).toHaveLength(10);
  });

  it("starts empty on a corrupt file and moves it aside", () => {
    const userData = tempDir();
    const file = fuelHistoryFile(userData);
    writeFileSync(file, "{not json", "utf8");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new FileFuelHistoryStore(file);
    expect(store.load(KEY)).toEqual([]);
    expect(readdirSync(userData).some((f) => f.includes(".bad-"))).toBe(true);
    vi.restoreAllMocks();
  });

  it("drops laps a hand edit made invalid", () => {
    const userData = tempDir();
    const file = fuelHistoryFile(userData);
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        entries: { [KEY]: { updatedAt: "x", laps: [{ used: 2, lapTimeS: 90 }, { used: -4 }] } },
      }),
      "utf8",
    );
    expect(new FileFuelHistoryStore(file).load(KEY)).toEqual([{ used: 2, lapTimeS: 90 }]);
  });

  it("reports a write failure to onError and does not throw", async () => {
    const userData = tempDir();
    // The parent of the file is a regular file, so the folder cannot be created.
    const blocker = join(userData, "blocker");
    writeFileSync(blocker, "x", "utf8");
    const onError = vi.fn();
    const store = new FileFuelHistoryStore(join(blocker, "fuel-history.json"), onError);
    expect(() => store.record(KEY, { used: 2, lapTimeS: null })).not.toThrow();
    await store.idle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).not.toContain("mazda");
    // The in-memory copy still serves the lap.
    expect(store.load(KEY)).toHaveLength(1);
  });
});
