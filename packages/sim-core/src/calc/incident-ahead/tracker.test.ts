import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type Car, type SessionPhase, type SimState } from "../../model";
import { SlowCarDetector } from "../slow-car";
import { CLEAR_HOLD_S, IncidentAheadTracker, OFF_TRIGGER_S, SLOW_TRIGGER_S } from "./tracker";
import { INCIDENT_AHEAD_RANGE_M, type IncidentAhead } from "./types";

const LENGTH_M = 4000;
const DT = 0.1;

/**
 * The player (0) at 50 m/s and other cars at a scripted speed each, positions advancing every
 * 0.1 s tick, run through the slow-car detector and the tracker as the Deriver does.
 */
class Scene {
  t = 10;
  pct = new Map<number, number>();
  speed = new Map<number, number>();
  patch = new Map<number, Partial<Car>>();
  phase: SessionPhase | null = "racing";
  trackName: string | null = null;
  readonly detector = new SlowCarDetector();
  readonly tracker: IncidentAheadTracker;

  constructor(
    corners?: (key: string | null) => { number: number; startPct: number; endPct: number }[],
  ) {
    this.tracker = new IncidentAheadTracker(corners === undefined ? {} : { corners });
    this.add(0, 0.2, 50);
  }

  add(carIdx: number, pct: number, speed: number, patch: Partial<Car> = {}): this {
    this.pct.set(carIdx, pct);
    this.speed.set(carIdx, speed);
    this.patch.set(carIdx, patch);
    return this;
  }

  /** Lap fraction `metres` ahead of the player. */
  ahead(metres: number): number {
    return (((this.pct.get(0)! + metres / LENGTH_M) % 1) + 1) % 1;
  }

  state(): SimState {
    const s = emptySimState("iracing");
    s.sim = "iracing";
    s.connected = true;
    s.tickTimeS = this.t;
    s.session.phase = this.phase;
    s.session.trackLengthM = LENGTH_M;
    s.session.trackName = this.trackName;
    s.playerCarIdx = 0;
    s.cars = [...this.pct.keys()].map((i) => ({
      ...emptyCar(i),
      connected: true,
      isOnTrack: true,
      onPitRoad: false,
      inPitStall: false,
      trackSurface: "onTrack",
      carNumber: String(i + 1),
      lapDistPct: this.pct.get(i)!,
      ...this.patch.get(i),
    }));
    return s;
  }

  /** Runs `seconds` of ticks and returns the last output. */
  run(seconds: number): IncidentAhead | null {
    let out: IncidentAhead | null = null;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const state = this.state();
      this.detector.next(state);
      out = this.tracker.next(state, this.detector.slowCars);
      this.t += DT;
      for (const [idx, pct] of this.pct) {
        const v = this.speed.get(idx)!;
        this.pct.set(idx, (((pct + (v * DT) / LENGTH_M) % 1) + 1) % 1);
      }
    }
    return out;
  }

  /** Car 1 runs `metres` ahead at the player's speed for a second, then drops to `speed`. */
  slowing(metres: number, speed: number, patch: Partial<Car> = {}): this {
    this.add(1, this.ahead(metres), 50, patch);
    this.run(1);
    this.speed.set(1, speed);
    return this;
  }
}

describe("IncidentAheadTracker", () => {
  it("exports the documented limits", () => {
    expect([SLOW_TRIGGER_S, OFF_TRIGGER_S, CLEAR_HOLD_S, INCIDENT_AHEAD_RANGE_M]).toEqual([
      1, 0.5, 1, 1000,
    ]);
  });

  it("reports a car that crawls ahead once it has been slow for a while", () => {
    const scene = new Scene().slowing(500, 8);
    expect(scene.run(0.8)).toBeNull();
    const out = scene.run(1.5);
    expect(out).toMatchObject({ carIdx: 1, carNumber: "2", kind: "slow", stopped: false });
    expect(out!.distanceM).toBeGreaterThan(300);
    expect(out!.distanceM).toBeLessThan(500);
    expect(out!.corner).toBeNull();
  });

  it("calls a standing car stopped", () => {
    const scene = new Scene().slowing(500, 0);
    expect(scene.run(2.5)).toMatchObject({ carIdx: 1, kind: "stopped", stopped: true });
  });

  it("reports a car off track after a short debounce, whatever its speed", () => {
    const scene = new Scene().add(1, 0.3, 50);
    scene.run(0.5);
    scene.patch.set(1, { trackSurface: "offTrack" });
    expect(scene.run(0.3)).toBeNull();
    expect(scene.run(0.5)).toMatchObject({ carIdx: 1, kind: "off", stopped: false });
  });

  it("names a stopped car off track as off, and still stopped", () => {
    const scene = new Scene().slowing(600, 0, { trackSurface: "offTrack" });
    expect(scene.run(2.5)).toMatchObject({ kind: "off", stopped: true });
  });

  it("ignores a kerb flicker shorter than the debounce", () => {
    const scene = new Scene().add(1, 0.3, 50);
    scene.run(0.5);
    scene.patch.set(1, { trackSurface: "offTrack" });
    scene.run(0.3);
    scene.patch.set(1, { trackSurface: "onTrack" });
    expect(scene.run(1)).toBeNull();
  });

  it("holds briefly after the car recovers, then clears", () => {
    const scene = new Scene().add(1, 0.3, 50);
    scene.run(0.5);
    scene.patch.set(1, { trackSurface: "offTrack" });
    expect(scene.run(1)).not.toBeNull();
    scene.patch.set(1, { trackSurface: "onTrack" });
    expect(scene.run(0.5)).toMatchObject({ kind: "off" });
    expect(scene.run(1)).toBeNull();
  });

  it("picks the nearest incident and ignores cars behind and beyond range", () => {
    const scene = new Scene().add(2, 0, 50).add(3, 0, 50);
    scene.add(2, scene.ahead(-200), 50, { trackSurface: "offTrack" });
    scene.add(3, scene.ahead(1100), 50, { trackSurface: "offTrack" });
    expect(scene.run(1)).toBeNull();
    scene.add(4, scene.ahead(700), 50, { trackSurface: "offTrack" });
    scene.add(5, scene.ahead(400), 50, { trackSurface: "offTrack" });
    expect(scene.run(1)).toMatchObject({ carIdx: 5 });
  });

  it("leaves out cars in the pits, the pace car, the player and cars not in the world", () => {
    const patches: Partial<Car>[] = [
      { onPitRoad: true },
      { inPitStall: true },
      { isPaceCar: true },
      { isOnTrack: false },
      { trackSurface: "notInWorld" },
      { connected: false },
    ];
    for (const patch of patches) {
      const scene = new Scene();
      scene.add(1, scene.ahead(300), 50, { trackSurface: "offTrack", ...patch });
      expect(scene.run(1.5)).toBeNull();
    }
    const own = new Scene();
    own.patch.set(0, { trackSurface: "offTrack" });
    expect(own.run(1.5)).toBeNull();
  });

  it("gives nothing while the player is in the pits", () => {
    const scene = new Scene().add(1, 0.3, 50, { trackSurface: "offTrack" });
    scene.patch.set(0, { onPitRoad: true });
    expect(scene.run(1.5)).toBeNull();
  });

  it("reports nothing in quiet phases", () => {
    for (const phase of ["garage", "gridding", "formation", "cooldown", null] as const) {
      const scene = new Scene().add(1, 0.3, 50, { trackSurface: "offTrack" });
      scene.phase = phase;
      expect(scene.run(1.5)).toBeNull();
    }
  });

  it("follows an incident across the start/finish line", () => {
    const scene = new Scene();
    scene.pct.set(0, 0.95);
    scene.add(1, 0.02, 50, { trackSurface: "offTrack" });
    const out = scene.run(1);
    expect(out).toMatchObject({ carIdx: 1 });
    expect(out!.distanceM).toBeCloseTo(0.07 * LENGTH_M, -1);
  });

  it("names the corner the car is in from the track's corner list", () => {
    const keys: (string | null)[] = [];
    const scene = new Scene((key) => {
      keys.push(key);
      return [{ number: 7, startPct: 0.28, endPct: 0.34 }];
    });
    scene.trackName = "Test Ring";
    scene.add(1, 0.3, 50, { trackSurface: "offTrack" });
    expect(scene.run(1)).toMatchObject({ corner: 7 });
    expect(keys).toEqual(["iracing_test-ring_4000m"]);
  });

  it("is null without a clock or track length, and forgets on reset", () => {
    const scene = new Scene().add(1, 0.3, 50, { trackSurface: "offTrack" });
    expect(scene.run(1)).not.toBeNull();
    const s = scene.state();
    s.session.trackLengthM = null;
    expect(scene.tracker.next(s, [])).toBeNull();
    s.session.trackLengthM = LENGTH_M;
    s.tickTimeS = null;
    expect(scene.tracker.next(s, [])).toBeNull();
    scene.tracker.reset();
    expect(scene.tracker.next(scene.state(), [])).toBeNull();
  });
});
