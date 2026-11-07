import { describe, expect, it } from "vitest";
import {
  FUEL_HISTORY_LAPS,
  FUEL_HISTORY_MAX_KEYS,
  addHistoryLap,
  carTrackKey,
  fuelHistoryKey,
  historyLaps,
  parseFuelHistory,
  type FuelHistoryFile,
} from "./history";

const empty: FuelHistoryFile = { version: 1, entries: {} };

describe("carTrackKey", () => {
  it("is the fuel key without its kind", () => {
    const args = ["iracing", "Mazda MX-5 Cup", "iracing_lime-rock_full"] as const;
    expect(carTrackKey(...args)).toBe("iracing|mazda-mx-5-cup|iracing_lime-rock_full");
    expect(`fuel|${carTrackKey(...args)}`).toBe(fuelHistoryKey("fuel", ...args));
  });

  it("keys LMU entries on the class and is null when anything is unknown", () => {
    expect(carTrackKey("lmu", "Team Alpha 2024 #12:Blue", "t", "Hypercar")).toBe("lmu|hypercar|t");
    expect(carTrackKey("lmu", "Team Beta 2025 #7:Red", "t", "Hypercar")).toBe("lmu|hypercar|t");
    expect(carTrackKey(null, "Car", "t")).toBeNull();
    expect(carTrackKey("iracing", null, "t")).toBeNull();
    expect(carTrackKey("iracing", "Car", "")).toBeNull();
  });
});

describe("fuelHistoryKey", () => {
  it("joins kind, sim, car slug and track key", () => {
    expect(fuelHistoryKey("fuel", "iracing", "Mazda MX-5 Cup", "iracing_lime-rock_full")).toBe(
      "fuel|iracing|mazda-mx-5-cup|iracing_lime-rock_full",
    );
    expect(fuelHistoryKey("energy", "lmu", "Ferrari 499P", "lmu_monza_5790m")).toBe(
      "energy|lmu|ferrari-499p|lmu_monza_5790m",
    );
  });

  it("keys LMU team entries on the class, not on team, year or number", () => {
    const a = fuelHistoryKey("fuel", "lmu", "Team Alpha 2024 #12:Blue", "t", "Hypercar");
    const b = fuelHistoryKey("fuel", "lmu", "Team Beta 2025 #7:Red", "t", "Hypercar");
    expect(a).toBe("fuel|lmu|hypercar|t");
    expect(b).toBe(a);
    expect(fuelHistoryKey("fuel", "lmu", "Team Alpha 2024 #12:Blue", "t", "LMGT3")).not.toBe(a);
    expect(fuelHistoryKey("fuel", "lmu", "Team Alpha 2024 #12:Blue", "t")).toBe(
      "fuel|lmu|team-alpha|t",
    );
  });

  it("strips accents like the track key does", () => {
    expect(fuelHistoryKey("fuel", "lmu", "Porsche Cayenne Café", "t")).toBe(
      "fuel|lmu|porsche-cayenne-cafe|t",
    );
  });

  it("is null when the sim, car or track is unknown", () => {
    expect(fuelHistoryKey("fuel", null, "Car", "t")).toBeNull();
    expect(fuelHistoryKey("fuel", "lmu", null, "t")).toBeNull();
    expect(fuelHistoryKey("fuel", "lmu", "!!!", "t")).toBeNull();
    expect(fuelHistoryKey("fuel", "lmu", "Car", null)).toBeNull();
  });
});

describe("parseFuelHistory", () => {
  it("gives an empty file for missing, corrupt or wrong-version data", () => {
    for (const raw of [undefined, null, 5, "x", [], {}, { version: 2, entries: {} }]) {
      expect(parseFuelHistory(raw)).toEqual(empty);
    }
    expect(parseFuelHistory({ version: 1, entries: [] })).toEqual(empty);
  });

  it("keeps good laps and drops hand-edited rubbish", () => {
    const file = parseFuelHistory({
      version: 1,
      entries: {
        a: {
          updatedAt: "2026-01-01T00:00:00Z",
          laps: [
            { used: 2.5, lapTimeS: 90 },
            { used: 0.1, lapTimeS: 90 },
            { used: 60, lapTimeS: 90 },
            { used: Number.NaN, lapTimeS: 90 },
            { used: "3", lapTimeS: 90 },
            { used: 3, lapTimeS: "slow" },
            null,
          ],
        },
        b: { updatedAt: "2026-01-01T00:00:00Z", laps: [{ used: 0, lapTimeS: null }] },
        c: "nope",
        d: { laps: "nope" },
      },
    });
    expect(Object.keys(file.entries)).toEqual(["a"]);
    expect(file.entries["a"]!.laps).toEqual([
      { used: 2.5, lapTimeS: 90 },
      { used: 3, lapTimeS: null },
    ]);
  });

  it("honours custom limits", () => {
    const raw = {
      version: 1,
      entries: { a: { updatedAt: "x", laps: [{ used: 80, lapTimeS: null }] } },
    };
    expect(parseFuelHistory(raw).entries).toEqual({});
    expect(Object.keys(parseFuelHistory(raw, { minUse: 1, maxUse: 100 }).entries)).toEqual(["a"]);
  });

  it("keeps the newest 10 laps of a key", () => {
    const laps = Array.from({ length: 11 }, (_, i) => ({ used: 1 + i, lapTimeS: null }));
    const file = parseFuelHistory({ version: 1, entries: { a: { updatedAt: "x", laps } } });
    expect(file.entries["a"]!.laps.map((l) => l.used)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("keeps the 200 most recently updated keys", () => {
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < FUEL_HISTORY_MAX_KEYS + 1; i++) {
      entries[`k${i}`] = {
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        laps: [{ used: 2, lapTimeS: null }],
      };
    }
    const file = parseFuelHistory({ version: 1, entries });
    expect(Object.keys(file.entries)).toHaveLength(FUEL_HISTORY_MAX_KEYS);
    expect(file.entries["k0"]).toBeUndefined();
    expect(file.entries["k200"]).toBeDefined();
  });
});

describe("addHistoryLap", () => {
  it("returns a new object and leaves the input alone", () => {
    const a = addHistoryLap(empty, "k", { used: 2, lapTimeS: 90 }, "2026-01-01T00:00:00Z");
    expect(empty.entries).toEqual({});
    const b = addHistoryLap(a, "k", { used: 3, lapTimeS: null }, "2026-01-02T00:00:00Z");
    expect(a.entries["k"]!.laps).toHaveLength(1);
    expect(b).not.toBe(a);
    expect(historyLaps(b, "k")).toEqual([
      { used: 2, lapTimeS: 90 },
      { used: 3, lapTimeS: null },
    ]);
    expect(b.entries["k"]!.updatedAt).toBe("2026-01-02T00:00:00Z");
  });

  it("keeps the newest 10 laps", () => {
    let f = empty;
    for (let i = 0; i < FUEL_HISTORY_LAPS + 3; i++) {
      f = addHistoryLap(f, "k", { used: 1 + i, lapTimeS: null }, "2026-01-01T00:00:00Z");
    }
    expect(historyLaps(f, "k").map((l) => l.used)[0]).toBe(4);
    expect(historyLaps(f, "k")).toHaveLength(FUEL_HISTORY_LAPS);
  });

  it("drops the stalest key beyond 200", () => {
    let f = empty;
    for (let i = 0; i <= FUEL_HISTORY_MAX_KEYS; i++) {
      const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
      f = addHistoryLap(f, `k${i}`, { used: 2, lapTimeS: null }, at);
    }
    expect(Object.keys(f.entries)).toHaveLength(FUEL_HISTORY_MAX_KEYS);
    expect(historyLaps(f, "k0")).toEqual([]);
  });

  it("returns [] for an unknown key", () => {
    expect(historyLaps(empty, "x")).toEqual([]);
  });
});
