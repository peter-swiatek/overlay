import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type SimState } from "../model";
import { Deriver } from "../telemetry/derive";
import { circle, lapSamples, squareOutline } from "./synthetic";
import { sameTrackKey, trackKeyOf } from "./track-key";
import { TrackTracker } from "./tracker";
import type { TrackOutlineStore, TrackOutline, TrackSample } from "./types";

const RADIUS = 400;
const LENGTH = 2 * Math.PI * RADIUS;

function state(
  sim: "iracing" | "lmu",
  sample: TrackSample,
  over: { name?: string | null; config?: string | null; length?: number | null } = {},
): SimState {
  const s = emptySimState(sim);
  s.sim = sim;
  s.connected = true;
  s.tickTimeS = sample.tickS;
  s.playerCarIdx = 0;
  s.session.trackName = over.name === undefined ? "Test Ring" : over.name;
  s.session.trackConfig = over.config === undefined ? "Grand Prix" : over.config;
  s.session.trackLengthM = over.length === undefined ? LENGTH : over.length;
  const car = emptyCar(0);
  car.connected = true;
  car.lapDistPct = sample.lapDistPct;
  car.onPitRoad = sample.onPitRoad;
  car.isOnTrack = sample.onTrack;
  car.bestLapS = sample.bestLapS;
  s.cars = [car];
  s.player.yawRad = sample.headingRad;
  s.player.velocityMps = sample.velocityMps === null ? null : { ...sample.velocityMps, z: 0 };
  s.player.worldPos =
    sample.worldPos === null ? null : { x: sample.worldPos.x, y: 0, z: sample.worldPos.z };
  return s;
}

class MemoryStore implements TrackOutlineStore {
  readonly files = new Map<string, TrackOutline>();
  saves: string[] = [];
  load(key: string): TrackOutline | null {
    return this.files.get(key) ?? null;
  }
  save(outline: TrackOutline): void {
    this.saves.push(`${outline.trackKey}:${outline.source}`);
    this.files.set(outline.trackKey, outline);
  }
}

/** Drives whole laps through a Deriver; a lap is judged when the next one starts. */
class Driver {
  private laps = 0;
  constructor(
    private readonly deriver: Deriver,
    private readonly sim: "iracing" | "lmu" = "iracing",
  ) {}

  lap(source: "integrated" | "world"): void {
    const samples = lapSamples(circle(RADIUS), { source, startTickS: this.laps++ * 101 });
    for (const sample of samples) this.deriver.next(state(this.sim, sample));
  }

  /**
   * The first tick of the next lap, which ends the one before, and one 6 s later: the verdict on
   * a lap waits up to 5 s for the best-lap update.
   */
  flush(): void {
    const next = lapSamples(circle(RADIUS), { startTickS: this.laps * 101 })[0];
    if (next === undefined) return;
    this.deriver.next(state(this.sim, next));
    this.deriver.next(state(this.sim, { ...next, tickS: next.tickS + 6, lapDistPct: 0.0006 }));
  }
}

describe("trackKeyOf", () => {
  it("joins the sim, the track and the layout into a file-name-safe key", () => {
    const s = emptySimState("iracing");
    s.sim = "iracing";
    s.session.trackName = "Virginia International Raceway";
    s.session.trackConfig = "Full Course";
    expect(trackKeyOf(s)).toBe("iracing_virginia-international-raceway_full-course");
    s.sim = "lmu";
    s.session.trackName = "Circuit de la Sarthe";
    s.session.trackConfig = null;
    expect(trackKeyOf(s)).toBe("lmu_circuit-de-la-sarthe");
    // Without a layout name the track length, rounded to 10 m, tells layouts apart.
    s.session.trackLengthM = 13623.97;
    expect(trackKeyOf(s)).toBe("lmu_circuit-de-la-sarthe_13620m");
    s.session.trackLengthM = 13626;
    expect(sameTrackKey(trackKeyOf(s) ?? "", "lmu_circuit-de-la-sarthe_13620m")).toBe(true);
    expect(sameTrackKey("lmu_circuit-de-la-sarthe_13620m", "lmu_circuit-de-la-sarthe_6200m")).toBe(
      false,
    );
    expect(sameTrackKey("lmu_a_100m", "lmu_b_100m")).toBe(false);
    s.session.trackLengthM = null;
    s.session.trackName = "Autódromo José Carlos Pace: Interlagos (GP)";
    expect(trackKeyOf(s)).toBe("lmu_autodromo-jose-carlos-pace-interlagos-gp");
    expect(trackKeyOf(s)).toMatch(/^[a-z0-9_-]+$/);
  });

  it("is null until the sim and the track are known", () => {
    const s = emptySimState("iracing");
    expect(trackKeyOf(s)).toBeNull();
    s.sim = "iracing";
    expect(trackKeyOf(s)).toBeNull();
    s.session.trackName = "Ring";
    expect(trackKeyOf(s)).toBe("iracing_ring");
    s.sim = null;
    expect(trackKeyOf(s)).toBeNull();
  });
});

describe("Deriver track output", () => {
  it("reports the key and builds, stores and exposes an outline after a clean lap", () => {
    const store = new MemoryStore();
    const deriver = new Deriver({ trackOutlines: store });
    const first = lapSamples(circle(RADIUS))[0] as TrackSample;
    expect(deriver.next(state("iracing", first)).track).toEqual({
      trackKey: "iracing_test-ring_grand-prix",
      outlineReady: false,
      pitExitLapDistPct: null,
      pitExitDistanceM: null,
    });
    expect(deriver.trackOutline).toBeNull();
    const driver = new Driver(deriver);
    driver.lap("integrated");
    driver.flush();
    expect(deriver.trackOutline?.source).toBe("integrated");
    expect(store.saves).toEqual(["iracing_test-ring_grand-prix:integrated"]);
    const after = deriver.next(state("iracing", first, { length: LENGTH }));
    expect(after.track).toEqual({
      trackKey: "iracing_test-ring_grand-prix",
      outlineReady: true,
      pitExitLapDistPct: null,
      pitExitDistanceM: null,
    });
  });

  it("does nothing for a state that is not connected", () => {
    expect(new Deriver().next(emptySimState("iracing")).track).toEqual({
      trackKey: null,
      outlineReady: false,
      pitExitLapDistPct: null,
      pitExitDistanceM: null,
    });
  });

  it("builds nothing while the track is unknown", () => {
    const deriver = new Deriver();
    const samples = lapSamples(circle(RADIUS));
    for (const s of samples) deriver.next(state("iracing", s, { name: null }));
    expect(deriver.trackOutline).toBeNull();
    expect(deriver.trackTracker.lastLap).toBeNull();
  });

  it("works through a session change without losing the outline", () => {
    const deriver = new Deriver();
    const driver = new Driver(deriver);
    driver.lap("integrated");
    driver.flush();
    deriver.reset();
    expect(deriver.trackOutline).not.toBeNull();
  });
});

describe("TrackTracker outline policy", () => {
  it("uses a stored outline and builds none", () => {
    const store = new MemoryStore();
    const stored = {
      ...squareOutline(),
      trackKey: "iracing_test-ring_grand-prix",
      lengthM: LENGTH,
    };
    store.files.set(stored.trackKey, stored);
    const deriver = new Deriver({ trackOutlines: store });
    const driver = new Driver(deriver);
    driver.lap("integrated");
    driver.flush();
    expect(deriver.trackOutline).toEqual(stored);
    expect(store.saves).toEqual([]);
    expect(deriver.trackTracker.lastLap).toBeNull();
  });

  it("ignores a stored outline of the wrong length, a damaged one, and one for another track", () => {
    for (const bad of [
      { ...squareOutline(), trackKey: "iracing_test-ring_grand-prix", lengthM: LENGTH * 1.2 },
      { trackKey: "iracing_test-ring_grand-prix", points: [] },
      { ...squareOutline(), trackKey: "iracing_other", lengthM: LENGTH },
    ]) {
      const store = new MemoryStore();
      store.files.set("iracing_test-ring_grand-prix", bad as TrackOutline);
      const tracker = new TrackTracker({ store });
      const s = lapSamples(circle(RADIUS))[0] as TrackSample;
      expect(tracker.update(state("iracing", s), null)).toEqual({
        trackKey: "iracing_test-ring_grand-prix",
        outlineReady: false,
        pitExitLapDistPct: null,
        pitExitDistanceM: null,
      });
    }
  });

  it("replaces an integrated outline with a world-position one, and nothing else", () => {
    const store = new MemoryStore();
    const deriver = new Deriver({ trackOutlines: store });
    const driver = new Driver(deriver);
    driver.lap("integrated");
    driver.lap("integrated");
    expect(deriver.trackOutline?.source).toBe("integrated");
    // The second integrated lap did not replace the first.
    driver.lap("world");
    expect(store.saves).toEqual(["iracing_test-ring_grand-prix:integrated"]);
    // A world-position lap does, once it is over.
    driver.lap("world");
    expect(deriver.trackOutline?.source).toBe("world");
    expect(store.saves).toEqual([
      "iracing_test-ring_grand-prix:integrated",
      "iracing_test-ring_grand-prix:world",
    ]);
    // And a world outline stays, whatever comes next.
    driver.lap("integrated");
    driver.lap("world");
    driver.flush();
    expect(store.saves).toHaveLength(2);
  });

  it("replaces an integrated outline by another that closed at least twice as well", () => {
    const store = new MemoryStore();
    const deriver = new Deriver({ trackOutlines: store });
    const key = "iracing_test-ring_grand-prix";
    const worse = {
      ...squareOutline(),
      trackKey: key,
      source: "integrated" as const,
      lengthM: LENGTH,
    };
    store.files.set(key, { ...worse, closureErrorM: 9 });
    const driver = new Driver(deriver);
    // The synthetic lap closes within about a metre, far better than the stored 9 m.
    driver.lap("integrated");
    driver.flush();
    expect(deriver.trackOutline?.closureErrorM).toBeLessThan(4.5);
    expect(store.saves).toEqual([`${key}:integrated`]);
    // A stored outline that is already good is left alone.
    const keep = { ...worse, closureErrorM: 0.5 };
    store.files.set(key, keep);
    const second = new Deriver({ trackOutlines: store });
    const driver2 = new Driver(second);
    driver2.lap("integrated");
    driver2.flush();
    expect(second.trackOutline).toEqual(keep);
    expect(store.saves).toHaveLength(1);
  });

  it("replaces a world outline that bridged a pit exit by a full lap, which is then final", () => {
    const store = new MemoryStore();
    const deriver = new Deriver({ trackOutlines: store });
    const key = "iracing_test-ring_grand-prix";
    let lapIndex = 0;
    const world = (from: number): void => {
      const samples = lapSamples(circle(RADIUS), {
        source: "world",
        from,
        startTickS: lapIndex++ * 101,
      });
      for (const sample of samples) deriver.next(state("iracing", sample));
    };
    const flush = (): void => {
      const next = lapSamples(circle(RADIUS), { startTickS: lapIndex * 101 })[0] as TrackSample;
      deriver.next(state("iracing", { ...next, worldPos: { x: 0, z: 0 } }));
      deriver.next(state("iracing", { ...next, tickS: next.tickS + 6, lapDistPct: 0.0006 }));
    };
    world(0.03);
    world(0.03);
    flush();
    const pitExit = deriver.trackOutline;
    expect(pitExit?.gapPct).toBeGreaterThan(0.025);
    expect(pitExit?.bridgeM).toBeGreaterThan(0.025 * LENGTH * 0.9);
    expect(store.saves).toEqual([`${key}:world`]);
    // A second pit-exit lap is no better: nothing is written.
    expect(store.saves).toHaveLength(1);
    world(0.0005);
    world(0.0005);
    flush();
    expect(deriver.trackOutline?.gapPct).toBeLessThan(0.005);
    expect(store.saves).toHaveLength(2);
    // The full lap is final.
    world(0.03);
    world(0.0005);
    flush();
    expect(store.saves).toHaveLength(2);
    expect(deriver.trackOutline?.gapPct).toBeLessThan(0.005);
  });

  it("holds the first timed lap's verdict for the best-lap update", () => {
    const deriver = new Deriver();
    const lap = lapSamples(circle(RADIUS), { startTickS: 0 });
    for (const s of lap) deriver.next(state("iracing", s));
    const next = lapSamples(circle(RADIUS), { startTickS: 101 })[0] as TrackSample;
    deriver.next(state("iracing", next));
    // No best lap yet: iRacing publishes it about 2 s after the line, so the lap waits.
    expect(deriver.trackTracker.lastLap).toBeNull();
    deriver.next(state("iracing", { ...next, tickS: next.tickS + 1, lapDistPct: 0.0006 }));
    expect(deriver.trackTracker.lastLap).toBeNull();
    deriver.next(
      state("iracing", { ...next, tickS: next.tickS + 2, lapDistPct: 0.0007, bestLapS: 100 }),
    );
    expect(deriver.trackTracker.lastLap?.ok).toBe(true);
  });

  it("keeps the best lap of the track, so that a slow first lap is caught", () => {
    const deriver = new Deriver();
    const lap = lapSamples(circle(RADIUS), { startTickS: 0 });
    // The best of 80 s was set earlier in the session; this lap takes 100 s.
    deriver.next(state("iracing", { ...(lap[0] as TrackSample), bestLapS: 80 }));
    for (const s of lap.slice(1)) deriver.next(state("iracing", { ...s, bestLapS: null }));
    deriver.next(
      state("iracing", lapSamples(circle(RADIUS), { startTickS: 101 })[0] as TrackSample),
    );
    expect(deriver.trackTracker.lastLap).toMatchObject({ ok: false, reason: "slow-lap" });
  });

  it("does not store a lap that was rejected", () => {
    const store = new MemoryStore();
    const deriver = new Deriver({ trackOutlines: store });
    const samples = lapSamples(circle(RADIUS)).map((s, i) =>
      i === 2000 ? { ...s, onPitRoad: true } : s,
    );
    for (const s of samples) deriver.next(state("iracing", s));
    const next = lapSamples(circle(RADIUS), { startTickS: 100.01 })[0] as TrackSample;
    deriver.next(state("iracing", next));
    expect(deriver.trackTracker.lastLap).toMatchObject({ ok: false, reason: "pit-road" });
    expect(store.saves).toEqual([]);
    expect(deriver.trackOutline).toBeNull();
  });

  it("starts over when the track changes", () => {
    const store = new MemoryStore();
    const deriver = new Deriver({ trackOutlines: store });
    const driver = new Driver(deriver);
    driver.lap("integrated");
    driver.flush();
    const s = lapSamples(circle(RADIUS))[0] as TrackSample;
    const out = deriver.next(state("iracing", s, { name: "Other Ring", config: null }));
    expect(out.track).toEqual({
      trackKey: "iracing_other-ring_2510m",
      outlineReady: false,
      pitExitLapDistPct: null,
      pitExitDistanceM: null,
    });
    expect(deriver.trackOutline).toBeNull();
  });
});
