import { describe, expect, it } from "vitest";
import type { FuelHistoryStore, SeedLap } from "../calc/fuel";
import { emptyCar, emptySimState, type SimName, type SimSource, type SimState } from "../model";
import { Deriver } from "./derive";
import type { Derived } from "./frame";

const FUEL_KEY = "fuel|iracing|mazda-mx-5-cup|iracing_lime-rock_full";

class FakeStore implements FuelHistoryStore {
  data = new Map<string, SeedLap[]>();
  records: [string, SeedLap][] = [];
  loads: string[] = [];
  load(key: string): readonly SeedLap[] {
    this.loads.push(key);
    return this.data.get(key) ?? [];
  }
  record(key: string, lap: SeedLap): void {
    this.records.push([key, lap]);
  }
}

interface Scene {
  sim?: SimName;
  source?: SimSource;
  car?: string;
  track?: string;
  onPitRoad?: boolean;
  /** Use per lap, in litres (percent of virtual energy for energy). */
  burn?: number;
  withEnergy?: boolean;
  withFuel?: boolean;
}

/** Drives whole laps in 11 one-second ticks; fuel falls in proportion to distance. */
class Drive {
  tick = 0;
  lap = 0;
  pct = 0.01;
  constructor(
    readonly scene: Scene = {},
    private readonly start = 40,
  ) {}

  state(): SimState {
    const sc = this.scene;
    const s = emptySimState(sc.sim ?? "iracing");
    s.source = sc.source ?? (sc.sim === "lmu" ? "lmu" : "iracing");
    s.sim = sc.sim ?? "iracing";
    s.connected = true;
    s.tickTimeS = this.tick;
    s.playerCarIdx = 0;
    s.session.type = "race";
    s.session.phase = "racing";
    s.session.timing = "laps";
    s.session.lapsTotal = 30;
    s.session.trackName = sc.track ?? "Lime Rock";
    s.session.trackConfig = sc.sim === "lmu" ? null : "Full";
    s.session.trackLengthM = 2400;
    const player = emptyCar(0);
    player.connected = true;
    player.carName = sc.car ?? "Mazda MX-5 Cup";
    player.lapsCompleted = this.lap;
    player.lapDistPct = this.pct;
    player.onPitRoad = sc.onPitRoad === true && this.lap === 0;
    player.inPitStall = false;
    player.isOnTrack = true;
    s.cars = [player];
    const burn = sc.burn ?? 2;
    const left = this.start - burn * (this.lap + this.pct - 0.01);
    if (sc.withFuel !== false) s.player.fuelL = left;
    if (sc.withEnergy === true)
      s.player.energyFraction = (100 - burn * (this.lap + this.pct - 0.01)) / 100;
    s.player.fuelCapacityL = 40;
    return s;
  }

  /** One tick; returns the state fed. */
  step(): SimState {
    this.tick++;
    return this.state();
  }

  /** One whole lap: 10 ticks along the lap, then the crossing. */
  lapOf(d: Deriver): Derived {
    let out: Derived | null = null;
    for (let i = 0; i < 10; i++) {
      this.tick++;
      this.pct = 0.05 + i * 0.1;
      out = d.next(this.state());
    }
    this.tick++;
    this.lap++;
    this.pct = 0.01;
    out = d.next(this.state());
    return out;
  }
}

function first(d: Deriver, drive: Drive): Derived {
  return d.next(drive.state());
}

describe("Deriver fuel history", () => {
  it("records valid laps with lap times and never invalid ones", () => {
    const store = new FakeStore();
    const d = new Deriver({ fuelHistory: store });
    const drive = new Drive({ onPitRoad: true });
    first(d, drive);
    for (let i = 0; i < 3; i++) drive.lapOf(d);
    // Lap 1 started on pit road (out lap): invalid. Laps 2 and 3 are valid.
    expect(d.fuelTracker.lapRecords.map((l) => l.valid)).toEqual([false, true, true]);
    expect(store.records).toHaveLength(2);
    for (const [key, lap] of store.records) {
      expect(key).toBe(FUEL_KEY);
      expect(lap.used).toBeCloseTo(2, 9);
      expect(lap.lapTimeS).toBe(11);
    }
  });

  it("seeds at session start when Keep fuel data is on, loading once", () => {
    const store = new FakeStore();
    store.data.set(
      FUEL_KEY,
      [3, 3, 3].map((used) => ({ used, lapTimeS: 90 })),
    );
    const d = new Deriver({ fuelHistory: store });
    d.setKeepFuelData(true);
    const drive = new Drive();
    const out = first(d, drive);
    expect(out.fuel?.fuelAvgLap).toBeCloseTo(3, 9);
    expect(out.fuel?.validLapCount).toBe(0);
    for (let i = 0; i < 3; i++) drive.lapOf(d);
    expect(store.loads).toEqual([FUEL_KEY]);
    // Two own laps by now: the seed no longer counts.
    expect(d.fuelTracker.snapshot({ lapsToGo: 5 }).fuelAvgLap).toBeCloseTo(2, 9);
  });

  it("seeds again for a new car and for a new track", () => {
    const store = new FakeStore();
    const d = new Deriver({ fuelHistory: store });
    d.setKeepFuelData(true);
    const a = new Drive();
    first(d, a);
    const b = new Drive({ car: "Ferrari 499P" });
    first(d, b);
    const c = new Drive({ car: "Ferrari 499P", track: "Sebring" });
    first(d, c);
    expect(store.loads).toEqual([
      FUEL_KEY,
      "fuel|iracing|ferrari-499p|iracing_lime-rock_full",
      "fuel|iracing|ferrari-499p|iracing_sebring_full",
    ]);
  });

  it("seeds again after a session reset", () => {
    const store = new FakeStore();
    const d = new Deriver({ fuelHistory: store });
    d.setKeepFuelData(true);
    const drive = new Drive();
    first(d, drive);
    d.reset();
    first(d, new Drive());
    expect(store.loads).toEqual([FUEL_KEY, FUEL_KEY]);
  });

  it("with Keep fuel data off nothing is seeded but laps are still recorded", () => {
    const store = new FakeStore();
    store.data.set(FUEL_KEY, [{ used: 3, lapTimeS: null }]);
    const d = new Deriver({ fuelHistory: store });
    const drive = new Drive();
    expect(first(d, drive).fuel?.fuelAvgLap).toBeNull();
    drive.lapOf(d);
    expect(store.loads).toEqual([]);
    expect(store.records).toHaveLength(1);
  });

  it("seeds once when turned on mid-session and clears when turned off", () => {
    const store = new FakeStore();
    store.data.set(
      FUEL_KEY,
      [3, 3].map((used) => ({ used, lapTimeS: null })),
    );
    const d = new Deriver({ fuelHistory: store });
    const drive = new Drive();
    first(d, drive);
    drive.lapOf(d);
    d.setKeepFuelData(true);
    drive.tick++;
    drive.pct = 0.05;
    const on = d.next(drive.state());
    expect(on.fuel?.fuelAvgLap).toBeCloseTo((3 + 3 + 2) / 3, 9);
    drive.tick++;
    drive.pct = 0.15;
    d.next(drive.state());
    expect(store.loads).toEqual([FUEL_KEY]);
    d.setKeepFuelData(false);
    drive.tick++;
    drive.pct = 0.25;
    expect(d.next(drive.state()).fuel?.fuelAvgLap).toBeCloseTo(2, 9);
  });

  it("keeps energy separate from fuel", () => {
    const store = new FakeStore();
    const energyKey = "energy|lmu|ferrari-499p|lmu_monza_2400m";
    store.data.set(
      energyKey,
      [10, 10].map((used) => ({ used, lapTimeS: null })),
    );
    const d = new Deriver({ fuelHistory: store });
    d.setKeepFuelData(true);
    const drive = new Drive({
      sim: "lmu",
      car: "Ferrari 499P",
      track: "Monza",
      burn: 5,
      withEnergy: true,
    });
    const out = first(d, drive);
    expect(out.energy?.fuelAvgLap).toBeCloseTo(10, 9);
    expect(out.fuel?.fuelAvgLap).toBeNull();
    drive.lapOf(d);
    drive.lapOf(d);
    const kinds = new Set(store.records.map(([k]) => k.split("|")[0]));
    expect(kinds).toEqual(new Set(["fuel", "energy"]));
    expect(store.records.filter(([k]) => k === energyKey)).toHaveLength(2);
    expect(store.loads.sort()).toEqual([energyKey, "fuel|lmu|ferrari-499p|lmu_monza_2400m"].sort());
  });

  it("records nothing for replay or mock sources", () => {
    for (const source of ["replay", "mock"] as const) {
      const store = new FakeStore();
      const d = new Deriver({ fuelHistory: store });
      const drive = new Drive({ source });
      first(d, drive);
      drive.lapOf(d);
      drive.lapOf(d);
      expect(store.records).toEqual([]);
    }
  });

  it("without a store the outputs are those of a plain deriver", () => {
    const plain = new Deriver();
    const kept = new Deriver();
    kept.setKeepFuelData(true);
    const a = new Drive();
    const b = new Drive();
    expect(first(kept, b)).toEqual(first(plain, a));
    for (let i = 0; i < 3; i++) expect(b.lapOf(kept)).toEqual(a.lapOf(plain));
  });
});
