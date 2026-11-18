import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type SimState } from "../model";
import { Deriver } from "../telemetry/derive";
import { distanceAheadM, type PitExitStore } from "./pit-exit";

const LENGTH = 4000;

function tick(
  t: number,
  pct: number,
  onPitRoad: boolean,
  over: { speed?: number | null; track?: string | null } = {},
): SimState {
  const s = emptySimState("iracing");
  s.sim = "iracing";
  s.connected = true;
  s.tickTimeS = t;
  s.playerCarIdx = 0;
  s.session.trackName = over.track === undefined ? "Test Ring" : over.track;
  s.session.trackConfig = "GP";
  s.session.trackLengthM = LENGTH;
  s.player.speedMps = over.speed === undefined ? 16 : over.speed;
  const car = emptyCar(0);
  car.connected = true;
  car.lapDistPct = pct;
  car.onPitRoad = onPitRoad;
  car.isOnTrack = true;
  s.cars = [car];
  return s;
}

class MemoryPitExits implements PitExitStore {
  readonly map = new Map<string, number>();
  saves: Array<[string, number]> = [];
  load(key: string): number | null {
    return this.map.get(key) ?? null;
  }
  save(key: string, pct: number): void {
    this.saves.push([key, pct]);
    this.map.set(key, pct);
  }
}

describe("distanceAheadM", () => {
  it("wraps and is null for unknown input", () => {
    expect(distanceAheadM(0.9, 0.95, 4000)).toBeCloseTo(200);
    expect(distanceAheadM(0.95, 0.02, 4000)).toBeCloseTo(280);
    expect(distanceAheadM(null, 0.1, 4000)).toBeNull();
    expect(distanceAheadM(0.1, 0.2, null)).toBeNull();
  });
});

describe("pit exit learning", () => {
  it("is unknown until the player leaves pit road, then stored per track", () => {
    const store = new MemoryPitExits();
    const d = new Deriver({ pitExits: store });
    let out = d.next(tick(0, 0.01, true)).track;
    expect(out.pitExitLapDistPct).toBeNull();
    expect(out.pitExitDistanceM).toBeNull();
    d.next(tick(1, 0.012, true));
    out = d.next(tick(2, 0.015, false)).track;
    expect(out.pitExitLapDistPct).toBe(0.015);
    expect(out.pitExitDistanceM).toBeNull();
    expect(store.saves).toEqual([["iracing_test-ring_gp", 0.015]]);
  });

  it("gives the metres to the exit while on pit road once it is known", () => {
    const store = new MemoryPitExits();
    store.map.set("iracing_test-ring_gp", 0.02);
    const d = new Deriver({ pitExits: store });
    const out = d.next(tick(0, 0.0, true)).track;
    expect(out.pitExitLapDistPct).toBe(0.02);
    expect(out.pitExitDistanceM).toBeCloseTo(80);
    expect(d.next(tick(1, 0.03, false)).track.pitExitDistanceM).toBeNull();
    // Wraps over the line.
    expect(d.next(tick(2, 0.99, true)).track.pitExitDistanceM).toBeCloseTo(120);
  });

  it("learns the first exit only", () => {
    const store = new MemoryPitExits();
    const d = new Deriver({ pitExits: store });
    d.next(tick(0, 0.01, true));
    d.next(tick(1, 0.015, false));
    d.next(tick(2, 0.5, true));
    d.next(tick(3, 0.51, false));
    expect(store.saves).toHaveLength(1);
  });

  it("ignores a reset to the track: standing still or a jump", () => {
    const store = new MemoryPitExits();
    const d = new Deriver({ pitExits: store });
    d.next(tick(0, 0.01, true, { speed: 0 }));
    d.next(tick(1, 0.01, false, { speed: 0 }));
    d.next(tick(2, 0.2, true));
    d.next(tick(3, 0.6, false));
    expect(store.saves).toEqual([]);
    expect(d.next(tick(4, 0.6, false)).track.pitExitLapDistPct).toBeNull();
  });

  it("works without a store and forgets the exit when the track changes", () => {
    const d = new Deriver();
    d.next(tick(0, 0.01, true));
    expect(d.next(tick(1, 0.015, false)).track.pitExitLapDistPct).toBe(0.015);
    expect(d.next(tick(2, 0.1, false, { track: "Other Ring" })).track.pitExitLapDistPct).toBeNull();
  });
});
