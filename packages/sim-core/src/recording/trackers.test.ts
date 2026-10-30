import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type SimState } from "../model";
import {
  IncidentTracker,
  lastLapMoved,
  LapAccumulator,
  lapInProgress,
  PitStopTracker,
  StintTracker,
  type PitStopEvent,
} from "./trackers";

interface Tick {
  t?: number;
  lapsCompleted?: number | null;
  onPitRoad?: boolean;
  inPitStall?: boolean;
  fuelL?: number | null;
  energy?: number | null;
  incidents?: number | null;
  position?: number | null;
  lastLapS?: number | null;
  trackTempC?: number | null;
  wear?: number | null;
}

function state(tick: Tick): SimState {
  const s = emptySimState("iracing");
  s.connected = true;
  s.tickTimeS = tick.t ?? 0;
  s.playerCarIdx = 3;
  const car = emptyCar(3);
  car.connected = true;
  car.lapsCompleted = tick.lapsCompleted === undefined ? 0 : tick.lapsCompleted;
  car.onPitRoad = tick.onPitRoad ?? false;
  car.inPitStall = tick.inPitStall ?? false;
  car.position = tick.position === undefined ? 4 : tick.position;
  car.lastLapS = tick.lastLapS ?? null;
  s.cars = [car];
  s.player.fuelL = tick.fuelL === undefined ? 50 : tick.fuelL;
  s.player.energyFraction = tick.energy ?? null;
  s.player.incidentCount = tick.incidents === undefined ? 0 : tick.incidents;
  s.conditions.trackTempC = tick.trackTempC === undefined ? 30 : tick.trackTempC;
  if (tick.wear !== undefined && tick.wear !== null) {
    const corner = { temps: { inner: null, middle: null, outer: null }, pressureKpa: null };
    s.player.tyres = {
      fl: { ...corner, wear: tick.wear },
      fr: { ...corner, wear: tick.wear },
      rl: { ...corner, wear: tick.wear },
      rr: { ...corner, wear: null },
    };
  }
  return s;
}

describe("lapInProgress", () => {
  it("is the counter the lap will end with", () => {
    const car = emptyCar(0);
    expect(lapInProgress(car)).toBe(0);
    car.lapsCompleted = 0;
    expect(lapInProgress(car)).toBe(1);
    car.lapsCompleted = 11;
    expect(lapInProgress(car)).toBe(12);
  });
});

describe("LapAccumulator", () => {
  it("summarises a lap and starts the next on the closing tick", () => {
    const acc = new LapAccumulator();
    const first = state({
      t: 100,
      fuelL: 50,
      energy: 0.9,
      incidents: 2,
      wear: 0.1,
      trackTempC: 30,
    });
    acc.observe(first);
    acc.close(first, true); // lap 1 begins at a crossing
    acc.observe(state({ t: 130, fuelL: 49, trackTempC: 32 }));
    acc.observe(state({ t: 160, fuelL: 48, trackTempC: 34, onPitRoad: false }));
    const end = state({
      t: 190.5,
      fuelL: 47.5,
      energy: 0.8,
      incidents: 5,
      wear: 0.14,
      trackTempC: 36,
      position: 2,
      lastLapS: 90.4,
    });
    acc.observe(end);
    const lap = acc.close(end, true);
    expect(lap.fuelStartL).toBe(50);
    expect(lap.fuelEndL).toBe(47.5);
    expect(lap.energyUsed).toBeCloseTo(0.1, 9);
    expect(lap.incidentsDelta).toBe(3);
    expect(lap.pitLap).toBe(false);
    expect(lap.trackTempC).toBeCloseTo((32 + 34 + 36) / 3, 9);
    expect(lap.tyreWearDelta).toBeCloseTo(0.04, 9);
    expect(lap.positionEnd).toBe(2);
    expect(lap.crossingTimeS).toBeCloseTo(90.5, 9);

    // The next lap started on the closing tick.
    const next = state({ t: 280.5, fuelL: 46 });
    acc.observe(next);
    expect(acc.close(next, true).fuelStartL).toBe(47.5);
  });

  it("flags a lap that touched pit road and gives no crossing time for a cut lap", () => {
    const acc = new LapAccumulator();
    acc.observe(state({ t: 10 }));
    acc.observe(state({ t: 50, onPitRoad: true }));
    const end = state({ t: 80 });
    acc.observe(end);
    const lap = acc.close(end, false);
    expect(lap.pitLap).toBe(true);
    expect(lap.crossingTimeS).toBeNull();
  });

  it("has no crossing time for the lap that was joined mid-way", () => {
    const acc = new LapAccumulator();
    const end = state({ t: 80 });
    acc.observe(state({ t: 10 }));
    acc.observe(end);
    expect(acc.close(end, true).crossingTimeS).toBeNull();
  });

  it("leaves unknown values null instead of making up zeros", () => {
    const acc = new LapAccumulator();
    const s = state({ t: 1, fuelL: null, incidents: null, trackTempC: null, position: null });
    acc.observe(s);
    const lap = acc.close(s, true);
    expect(lap.fuelStartL).toBeNull();
    expect(lap.energyUsed).toBeNull();
    expect(lap.incidentsDelta).toBeNull();
    expect(lap.trackTempC).toBeNull();
    expect(lap.tyreWearDelta).toBeNull();
    expect(lap.positionEnd).toBeNull();
  });
});

describe("lastLapMoved", () => {
  it("is true only for a new positive value", () => {
    expect(lastLapMoved(88.1, 90.011)).toBe(true);
    expect(lastLapMoved(null, 90.011)).toBe(true);
    expect(lastLapMoved(90.011, 90.011)).toBe(false);
    expect(lastLapMoved(88, -1)).toBe(false);
    expect(lastLapMoved(88, 0)).toBe(false);
    expect(lastLapMoved(88, null)).toBe(false);
  });
});

describe("IncidentTracker", () => {
  it("reports increases, starting from the count it joined with", () => {
    const tracker = new IncidentTracker();
    expect(tracker.update(state({ t: 1, incidents: 4 }))).toBeNull();
    expect(tracker.update(state({ t: 2, incidents: 4 }))).toBeNull();
    expect(tracker.update(state({ t: 3, incidents: 6, lapsCompleted: 2 }))).toEqual({
      lap: 3,
      timeS: 3,
      countDelta: 2,
    });
    expect(tracker.update(state({ t: 4, incidents: 0 }))).toBeNull();
    expect(tracker.update(state({ t: 5, incidents: 1 }))?.countDelta).toBe(1);
    expect(tracker.update(state({ t: 6, incidents: null }))).toBeNull();
  });
});

describe("PitStopTracker and StintTracker", () => {
  function run(ticks: Tick[]): PitStopEvent[] {
    const tracker = new PitStopTracker();
    const stops: PitStopEvent[] = [];
    for (const tick of ticks) {
      const stop = tracker.update(state(tick));
      if (stop) stops.push(stop);
    }
    return stops;
  }

  it("records a stop with its stationary time and the fuel added", () => {
    const stops = run([
      { t: 100, lapsCompleted: 4, fuelL: 20 },
      { t: 101, lapsCompleted: 4, onPitRoad: true, fuelL: 19.9 },
      { t: 102, lapsCompleted: 4, onPitRoad: true, fuelL: 19.8 },
      { t: 103, lapsCompleted: 4, onPitRoad: true, inPitStall: true, fuelL: 19.8 },
      { t: 104, lapsCompleted: 4, onPitRoad: true, inPitStall: true, fuelL: 25 },
      { t: 105, lapsCompleted: 4, onPitRoad: true, inPitStall: true, fuelL: 40 },
      { t: 106, lapsCompleted: 4, onPitRoad: true, inPitStall: true, fuelL: 40 },
      { t: 107, lapsCompleted: 5, onPitRoad: true, fuelL: 40 },
      { t: 108, lapsCompleted: 5, fuelL: 39.9 },
    ]);
    expect(stops).toHaveLength(1);
    const stop = stops[0] as PitStopEvent;
    expect(stop.lap).toBe(5);
    expect(stop.exitLap).toBe(6);
    expect(stop.entryTimeS).toBe(101);
    expect(stop.exitTimeS).toBe(108);
    expect(stop.stationaryS).toBe(3);
    expect(stop.fuelAddedL).toBeCloseTo(20.2, 9);
    const stint = new StintTracker().onPitStop(stop);
    expect(stint).toEqual({
      endedAtLap: 5,
      next: { startLap: 6, fuelAddedAtStartL: stop.fuelAddedL },
    });
  });

  it("does not count a session that starts in the garage or an exit never seen", () => {
    expect(
      run([
        { t: 1, onPitRoad: true, inPitStall: true },
        { t: 2, onPitRoad: true },
        { t: 3, onPitRoad: false },
      ]),
    ).toEqual([]);
    expect(run([{ t: 1 }, { t: 2, onPitRoad: true }, { t: 3, onPitRoad: true }])).toEqual([]);
  });

  it("treats a drive-through as a stop that does not end the stint", () => {
    const stops = run([{ t: 1 }, { t: 2, onPitRoad: true }, { t: 3, onPitRoad: true }, { t: 4 }]);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.stationaryS).toBe(0);
    expect(new StintTracker().onPitStop(stops[0] as PitStopEvent)).toBeNull();
  });

  it("caps a data gap when counting stationary time", () => {
    const stops = run([
      { t: 1 },
      { t: 2, onPitRoad: true, inPitStall: true },
      { t: 500, onPitRoad: true, inPitStall: true },
      { t: 501, onPitRoad: false },
    ]);
    expect(stops[0]?.stationaryS).toBe(1);
  });

  it("finds two stops in a row", () => {
    const visit = (t: number): Tick[] => [
      { t, onPitRoad: true },
      { t: t + 1, onPitRoad: true, inPitStall: true },
      { t: t + 2, onPitRoad: true, inPitStall: true },
      { t: t + 3, onPitRoad: false },
    ];
    expect(run([{ t: 0 }, ...visit(1), { t: 10 }, ...visit(20)])).toHaveLength(2);
  });
});
