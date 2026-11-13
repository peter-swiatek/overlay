import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type SimState, type TrackSurface } from "../../model";
import {
  cornerAt,
  IncidentLogTracker,
  kindOfPoints,
  OFF_TRACK_GAP_S,
  OFF_TRACK_MIN_S,
  POINTS_MERGE_S,
  sectorAt,
} from "./tracker";
import { INCIDENT_LOG_MAX } from "./types";

const DT = 0.1;

/** Two cars: the player (0) and another car (1), with a scripted surface and incident count. */
class Session {
  readonly tracker = new IncidentLogTracker();
  t = 100;
  count: number | null = 0;
  surface: Record<number, TrackSurface | null> = { 0: "onTrack", 1: "onTrack" };
  pct: Record<number, number> = { 0: 0.1, 1: 0.6 };
  lapsCompleted = 4;

  state(): SimState {
    const s = emptySimState("iracing");
    s.sim = "iracing";
    s.connected = true;
    s.tickTimeS = this.t;
    s.playerCarIdx = 0;
    s.session.sectorStartPcts = [0, 0.3, 0.7];
    s.cars = [0, 1].map((i) => {
      const car = emptyCar(i);
      car.connected = true;
      car.carNumber = String(i + 10);
      car.driverName = `Test Driver ${i}`;
      car.lapsCompleted = this.lapsCompleted;
      car.lapInProgress = this.lapsCompleted + 1;
      car.lapDistPct = this.pct[i] ?? null;
      car.trackSurface = this.surface[i] ?? null;
      return car;
    });
    s.player.incidentCount = this.count;
    s.player.trackSurface = this.surface[0] ?? null;
    return s;
  }

  tick(seconds = DT) {
    const steps = Math.max(1, Math.round(seconds / DT));
    let out = this.tracker.next(this.state());
    for (let i = 1; i < steps; i++) {
      this.t += DT;
      out = this.tracker.next(this.state());
    }
    this.t += DT;
    return out;
  }
}

describe("kindOfPoints", () => {
  it("types incident points like the sim's rules", () => {
    expect(kindOfPoints(1)).toBe("off-track");
    expect(kindOfPoints(2)).toBe("loss-of-control");
    expect(kindOfPoints(4)).toBe("contact");
    expect(kindOfPoints(3)).toBe("incident");
    expect(kindOfPoints(8)).toBe("incident");
  });
});

describe("sectorAt / cornerAt", () => {
  it("finds the 1-based sector", () => {
    expect(sectorAt([0, 0.3, 0.7], 0)).toBe(1);
    expect(sectorAt([0, 0.3, 0.7], 0.3)).toBe(2);
    expect(sectorAt([0, 0.3, 0.7], 0.99)).toBe(3);
    expect(sectorAt(null, 0.5)).toBeNull();
    expect(sectorAt([0, 0.5], null)).toBeNull();
  });

  it("finds the corner, one just behind on its exit, and one across the line", () => {
    const corners = [
      { number: 1, startPct: 0.1, endPct: 0.15 },
      { number: 2, startPct: 0.97, endPct: 0.02 },
    ];
    expect(cornerAt(corners, 0.12)).toBe(1);
    expect(cornerAt(corners, 0.153)).toBe(1);
    expect(cornerAt(corners, 0.2)).toBeNull();
    expect(cornerAt(corners, 0.99)).toBe(2);
    expect(cornerAt(corners, 0.01)).toBe(2);
    expect(cornerAt([], 0.5)).toBeNull();
  });
});

describe("IncidentLogTracker: the player's incident points", () => {
  it("takes the first count as the baseline and logs each increase", () => {
    const s = new Session();
    s.count = 3;
    expect(s.tick()?.events).toEqual([]);
    s.count = 4;
    s.pct[0] = 0.5;
    const log = s.tick();
    expect(log?.events).toHaveLength(1);
    expect(log?.events[0]).toMatchObject({
      carIdx: 0,
      carNumber: "10",
      driverName: "Test Driver 0",
      lap: 5,
      sector: 2,
      corner: null,
      kind: "off-track",
      points: 1,
      own: true,
    });
  });

  it("merges an upgrade within the merge window into one event", () => {
    const s = new Session();
    s.tick();
    s.count = 1;
    const first = s.tick()?.events[0];
    s.tick(POINTS_MERGE_S - 1);
    s.count = 2;
    const events = s.tick()?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: first?.id, points: 2, kind: "loss-of-control" });
    expect(events[0]?.timeS).toBe(first?.timeS);
  });

  it("logs a separate event after the merge window", () => {
    const s = new Session();
    s.tick();
    s.count = 4;
    s.tick();
    s.tick(POINTS_MERGE_S + 1);
    s.count = 6;
    const events = s.tick()?.events ?? [];
    expect(events.map((e) => [e.kind, e.points])).toEqual([
      ["loss-of-control", 2],
      ["contact", 4],
    ]);
  });

  it("re-baselines when the count goes back (a new session)", () => {
    const s = new Session();
    s.count = 6;
    s.tick();
    s.count = 0;
    expect(s.tick()?.events).toEqual([]);
    s.count = 2;
    expect(s.tick()?.events.map((e) => e.points)).toEqual([2]);
  });

  it("does not log the player's own off-tracks when the sim counts incidents", () => {
    const s = new Session();
    s.tick();
    s.surface[0] = "offTrack";
    s.tick(2);
    expect(s.tick()?.events).toEqual([]);
  });
});

describe("IncidentLogTracker: off-track excursions", () => {
  it("logs an excursion that lasts, with the place where it started, without points", () => {
    const s = new Session();
    s.tick();
    s.surface[1] = "offTrack";
    s.pct[1] = 0.75;
    const start = s.t;
    s.tick();
    s.pct[1] = 0.8;
    const log = s.tick(OFF_TRACK_MIN_S + DT);
    expect(log?.events).toHaveLength(1);
    expect(log?.events[0]).toMatchObject({
      carIdx: 1,
      carNumber: "11",
      kind: "off-track",
      points: null,
      sector: 3,
      own: false,
    });
    expect(log?.events[0]?.timeS).toBeCloseTo(start);
  });

  it("ignores a short dip off track", () => {
    const s = new Session();
    s.tick();
    s.surface[1] = "offTrack";
    s.tick();
    s.surface[1] = "onTrack";
    expect(s.tick()?.events).toEqual([]);
  });

  it("counts a car that goes off again soon after as the same excursion", () => {
    const s = new Session();
    s.tick();
    s.surface[1] = "offTrack";
    s.tick(1);
    s.surface[1] = "onTrack";
    s.tick(OFF_TRACK_GAP_S - 2);
    s.surface[1] = "offTrack";
    expect(s.tick(1)?.events).toHaveLength(1);
    s.surface[1] = "onTrack";
    s.tick(OFF_TRACK_GAP_S + 1);
    s.surface[1] = "offTrack";
    expect(s.tick(1)?.events).toHaveLength(2);
  });

  it("only counts going off from the track, not appearing off track", () => {
    const s = new Session();
    s.surface[1] = "notInWorld";
    s.tick();
    s.surface[1] = "offTrack";
    expect(s.tick(2)?.events).toEqual([]);
  });

  it("logs the player's off-tracks when the sim gives no incident count", () => {
    const s = new Session();
    s.count = null;
    s.tick();
    s.surface[0] = "offTrack";
    const events = s.tick(1)?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ carIdx: 0, own: true, points: null });
  });

  it("labels the corner from the track's corner list", () => {
    const keys: (string | null)[] = [];
    const tracker = new IncidentLogTracker({
      corners: (key) => {
        keys.push(key);
        return [{ number: 7, startPct: 0.6, endPct: 0.65 }];
      },
    });
    const s = new Session();
    const state = () => {
      const st = s.state();
      st.session.trackName = "Test Ring";
      return st;
    };
    tracker.next(state());
    s.surface[1] = "offTrack";
    s.pct[1] = 0.62;
    for (let i = 0; i < 6; i++) {
      s.t += DT;
      tracker.next(state());
    }
    expect(tracker.next(state())?.events[0]).toMatchObject({ kind: "off-track", corner: 7 });
    expect(keys).toEqual(["iracing_test-ring"]);
  });
});

describe("IncidentLogTracker: the log", () => {
  it("keeps the newest events, newest first, with increasing ids", () => {
    const s = new Session();
    s.tick();
    for (let n = 1; n <= INCIDENT_LOG_MAX + 5; n++) {
      s.count = (s.count ?? 0) + 1;
      s.tick(POINTS_MERGE_S + 1);
    }
    const events = s.tick()?.events ?? [];
    expect(events).toHaveLength(INCIDENT_LOG_MAX);
    const ids = events.map((e) => e.id);
    expect(ids[0]).toBe(INCIDENT_LOG_MAX + 5);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
  });

  it("publishes the same object until something changes, and forgets on reset", () => {
    const s = new Session();
    const a = s.tick();
    expect(s.tick()).toBe(a);
    s.count = 1;
    const b = s.tick();
    expect(b).not.toBe(a);
    s.tracker.reset();
    expect(s.tick()?.events).toEqual([]);
  });

  it("returns null before a live tick", () => {
    const tracker = new IncidentLogTracker();
    expect(tracker.next(emptySimState("iracing"))).toBeNull();
  });
});
