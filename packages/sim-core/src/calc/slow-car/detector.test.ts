import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type Car, type SessionPhase, type SimState } from "../../model";
import { SLOW_CAR_RANGE_M } from "./types";
import { SLOW_FOR_S, SLOW_MPS, STOPPED_MPS, SlowCarDetector } from "./detector";

const LENGTH_M = 4000;
const DT = 0.1;

/** Cars keep a constant speed per carIdx (m/s); positions advance by it every 0.1 s tick. */
class Track {
  tick = 0;
  pct = new Map<number, number>();
  speed = new Map<number, number>();
  phase: SessionPhase | null = "racing";
  trackLengthM: number | null = LENGTH_M;
  tickTimeNull = false;
  cars: Car[] = [];
  playerIdx = 0;

  add(carIdx: number, pct: number, speed: number, patch: Partial<Car> = {}): this {
    this.pct.set(carIdx, pct);
    this.speed.set(carIdx, speed);
    this.cars = this.cars.filter((c) => c.carIdx !== carIdx);
    this.cars.push({
      ...emptyCar(carIdx),
      connected: true,
      isOnTrack: true,
      onPitRoad: false,
      inPitStall: false,
      lapsCompleted: 3,
      lapDistPct: pct,
      ...patch,
    });
    return this;
  }

  /** Lap fraction `metres` ahead of the player. */
  ahead(metres: number): number {
    return (((this.pct.get(this.playerIdx)! + metres / LENGTH_M) % 1) + 1) % 1;
  }

  state(): SimState {
    const s = emptySimState("iracing");
    s.connected = true;
    s.tickTimeS = this.tickTimeNull ? null : this.tick * DT;
    s.session.phase = this.phase;
    s.session.trackLengthM = this.trackLengthM;
    s.playerCarIdx = this.playerIdx;
    s.cars = this.cars.map((c) => ({ ...c, lapDistPct: this.pct.get(c.carIdx)! }));
    return s;
  }

  step(): void {
    this.tick++;
    for (const [idx, pct] of this.pct) {
      const v = this.speed.get(idx)!;
      this.pct.set(idx, (((pct + (v * DT) / LENGTH_M) % 1) + 1) % 1);
    }
  }
}

function run(track: Track, det: SlowCarDetector, seconds: number) {
  let out = det.next(track.state());
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    track.step();
    out = det.next(track.state());
  }
  return out;
}

function scene(opts: { slowAhead?: number; slowSpeed?: number } = {}): Track {
  const t = new Track().add(0, 0.2, 50);
  t.add(1, t.ahead(opts.slowAhead ?? 300), opts.slowSpeed ?? 10);
  return t;
}

describe("SlowCarDetector", () => {
  it("exports the documented limits", () => {
    expect([SLOW_MPS, STOPPED_MPS, SLOW_FOR_S, SLOW_CAR_RANGE_M]).toEqual([15, 2, 0.5, 1000]);
  });

  it("reports a car slowed to 10 m/s, 300 m ahead, after 0.5 s", () => {
    const track = scene();
    const det = new SlowCarDetector();
    expect(run(track, det, 0.3)).toBeNull();
    const out = run(track, det, 0.5);
    expect(out).not.toBeNull();
    expect(out!.carIdx).toBe(1);
    expect(out!.speedMps).toBeCloseTo(10, 1);
    expect(out!.stopped).toBe(false);
    expect(out!.distanceM).toBeGreaterThan(200);
    expect(out!.distanceM).toBeLessThan(300);
  });

  it("flags a stopped car", () => {
    const track = scene({ slowSpeed: 0 });
    const out = run(track, new SlowCarDetector(), 1);
    expect(out).toMatchObject({ carIdx: 1, stopped: true });
    expect(out!.speedMps).toBeCloseTo(0, 3);
    expect(out!.distanceM).toBeCloseTo(250, 0);
  });

  it("ignores a fast car, a slow car behind and one 1200 m ahead", () => {
    expect(run(scene({ slowSpeed: 40 }), new SlowCarDetector(), 2)).toBeNull();
    expect(run(scene({ slowAhead: -300 }), new SlowCarDetector(), 2)).toBeNull();
    expect(run(scene({ slowAhead: 1200 }), new SlowCarDetector(), 2)).toBeNull();
  });

  it("picks the nearest of several slow cars ahead", () => {
    const track = scene({ slowAhead: 600, slowSpeed: 5 });
    track.add(2, track.ahead(200), 8);
    const out = run(track, new SlowCarDetector(), 1);
    expect(out!.carIdx).toBe(2);
  });

  it("ignores cars on pit road, in the stall, the pace car and cars not in the world", () => {
    const patches: Partial<Car>[] = [
      { onPitRoad: true },
      { inPitStall: true },
      { isPaceCar: true },
      { isOnTrack: false },
      { trackSurface: "notInWorld" },
      { connected: false },
    ];
    for (const patch of patches) {
      const track = scene();
      track.add(1, track.ahead(300), 10, patch);
      expect(run(track, new SlowCarDetector(), 2)).toBeNull();
    }
  });

  it("gives nothing while the player is on pit road or off track", () => {
    for (const patch of [{ onPitRoad: true }, { isOnTrack: false }]) {
      const track = new Track().add(0, 0.2, 50, patch);
      track.add(1, track.ahead(300), 10);
      expect(run(track, new SlowCarDetector(), 2)).toBeNull();
    }
  });

  it("does not report a brief dip of 0.3 s", () => {
    const track = new Track().add(0, 0.2, 50).add(1, 0.3, 40);
    const det = new SlowCarDetector();
    run(track, det, 1);
    track.speed.set(1, 5);
    expect(run(track, det, 0.3)).toBeNull();
    track.speed.set(1, 40);
    expect(run(track, det, 2)).toBeNull();
  });

  it("follows a slow car across the start/finish line", () => {
    const track = new Track().add(0, 0.97, 50);
    track.add(1, 0.999, 10, { lapsCompleted: null });
    const det = new SlowCarDetector();
    run(track, det, 0.2);
    const out = run(track, det, 1);
    expect(out).not.toBeNull();
    expect(out!.carIdx).toBe(1);
    expect(out!.speedMps).toBeCloseTo(10, 1);
    expect(track.pct.get(1)!).toBeLessThan(0.1);
  });

  it("reports nothing in garage, gridding, formation and cool-down", () => {
    for (const phase of ["garage", "gridding", "formation", "cooldown", null] as const) {
      const track = scene();
      track.phase = phase;
      expect(run(track, new SlowCarDetector(), 2)).toBeNull();
    }
  });

  it("restarts the clock when the grid phase ends", () => {
    const track = scene({ slowSpeed: 0 });
    const det = new SlowCarDetector();
    track.phase = "gridding";
    run(track, det, 2);
    track.phase = "racing";
    expect(run(track, det, 0.2)).toBeNull();
    expect(run(track, det, 0.6)).not.toBeNull();
  });

  it("is null without track length, tick time or player position", () => {
    const a = scene();
    a.trackLengthM = null;
    expect(run(a, new SlowCarDetector(), 2)).toBeNull();
    const b = scene();
    b.tickTimeNull = true;
    expect(run(b, new SlowCarDetector(), 2)).toBeNull();
    const c = scene();
    c.playerIdx = 9;
    expect(run(c, new SlowCarDetector(), 2)).toBeNull();
  });

  it("forgets the estimate when a car teleports", () => {
    const track = scene({ slowSpeed: 0 });
    const det = new SlowCarDetector();
    expect(run(track, det, 1)).not.toBeNull();
    track.pct.set(1, track.ahead(500));
    expect(run(track, det, DT)).toBeNull();
    expect(run(track, det, 0.3)).toBeNull();
    expect(run(track, det, 0.4)).not.toBeNull();
  });

  it("reset forgets all estimates", () => {
    const track = scene({ slowSpeed: 0 });
    const det = new SlowCarDetector();
    expect(run(track, det, 1)).not.toBeNull();
    det.reset();
    expect(det.next(track.state())).toBeNull();
  });
});
