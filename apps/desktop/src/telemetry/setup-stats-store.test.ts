import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETUP_MAX_COMBOS, addSetupLap, emptySetupCombo, type SetupCombo } from "@overlay/sim-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSetupStatsStore, parseSetupStatsFile, setupStatsFile } from "./setup-stats-store";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "overlay-setups-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const KEY = "iracing|porsche-911-gt3-r|iracing_spa_gp";

function combo(updatedAt: string, baseline: string | null = null): SetupCombo {
  const c = addSetupLap(
    emptySetupCombo(),
    "spa_race_v1",
    { lapTimeS: 138.4, sectorTimes: [40, 60, 38.4], topSpeedMps: 80, fuelUsedL: 3.1 },
    updatedAt,
  );
  return { ...c, baseline };
}

describe("FileSetupStatsStore", () => {
  it("keeps combos in userData/setup-stats.json and reads them back after a restart", async () => {
    const userData = tempDir();
    const file = setupStatsFile(userData);
    expect(file).toBe(join(userData, "setup-stats.json"));
    const store = new FileSetupStatsStore(file);
    expect(store.load(KEY)).toBeNull();
    store.save(KEY, combo("2026-01-01T00:00:00.000Z", "spa_race_v1"));
    await store.idle();
    expect(readdirSync(userData)).toEqual(["setup-stats.json"]);
    const again = new FileSetupStatsStore(file);
    expect(again.load(KEY)).toEqual(combo("2026-01-01T00:00:00.000Z", "spa_race_v1"));
  });

  it("keeps at most the combo limit, dropping the one changed longest ago", async () => {
    const file = setupStatsFile(tempDir());
    const store = new FileSetupStatsStore(file);
    for (let i = 0; i <= SETUP_MAX_COMBOS; i++) {
      store.save(
        `k${i}`,
        combo(`2026-01-01T00:${String(i % 60).padStart(2, "0")}:${i >= 60 ? "30" : "00"}.000Z`),
      );
    }
    await store.idle();
    const saved = JSON.parse(readFileSync(file, "utf8")) as { combos: Record<string, unknown> };
    expect(Object.keys(saved.combos)).toHaveLength(SETUP_MAX_COMBOS);
    expect(saved.combos["k0"]).toBeUndefined();
    expect(saved.combos[`k${SETUP_MAX_COMBOS}`]).toBeDefined();
  });

  it("starts empty on a corrupt file and drops combos a hand edit broke", () => {
    const userData = tempDir();
    const file = setupStatsFile(userData);
    writeFileSync(file, "{not json", "utf8");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(new FileSetupStatsStore(file).load(KEY)).toBeNull();
    vi.restoreAllMocks();
    expect(parseSetupStatsFile({ version: 2, combos: { [KEY]: combo("t") } }).combos).toEqual({});
    expect(
      Object.keys(
        parseSetupStatsFile({ version: 1, combos: { [KEY]: combo("t"), bad: 3 } }).combos,
      ),
    ).toEqual([KEY]);
  });

  it("reports a write failure to onError and does not throw", async () => {
    const userData = tempDir();
    const blocker = join(userData, "blocker");
    writeFileSync(blocker, "x", "utf8");
    const onError = vi.fn();
    const store = new FileSetupStatsStore(join(blocker, "setup-stats.json"), onError);
    expect(() => store.save(KEY, combo("t"))).not.toThrow();
    await store.idle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).not.toContain("spa");
    expect(store.load(KEY)).not.toBeNull();
  });
});
