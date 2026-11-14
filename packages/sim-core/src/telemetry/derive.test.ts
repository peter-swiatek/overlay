import { describe, expect, it } from "vitest";
import { FIXTURE_DIR, loadSlice, toStates } from "../adapters/iracing/slice-support";
import { emptyCar, emptySimState, type SessionPhase, type SimState } from "../model";
import type { StandingsInputs } from "../calc/standings";
import { Deriver } from "./derive";
import { emptyDerived, type Derived } from "./frame";

function simState(over: {
  type?: "race" | "practice";
  phase?: SessionPhase;
  tick: number;
  lap?: number;
  pct?: number;
  fuel?: number;
}): SimState {
  const s = emptySimState("iracing");
  s.connected = true;
  s.tickTimeS = over.tick;
  s.playerCarIdx = 0;
  s.session.type = over.type ?? "race";
  s.session.phase = over.phase ?? "racing";
  const player = emptyCar(0);
  player.connected = true;
  player.lapsCompleted = over.lap ?? 0;
  player.lapDistPct = over.pct ?? 0.5;
  player.onPitRoad = false;
  player.inPitStall = false;
  player.isOnTrack = true;
  s.cars = [player];
  s.player.fuelL = over.fuel ?? 50;
  return s;
}

describe("Deriver", () => {
  it("returns empty output for a disconnected state", () => {
    const out = new Deriver().next(emptySimState("lmu"));
    expect(out).toEqual({
      fuel: null,
      gaps: [],
      track: {
        trackKey: null,
        outlineReady: false,
        pitExitLapDistPct: null,
        pitExitDistanceM: null,
      },
      standings: null,
      proximity: null,
      delta: null,
      slowCar: null,
      energy: null,
      laps: null,
      tyreStint: null,
      incidentLog: null,
      incidentAhead: null,
      setupCompare: null,
    });
  });

  it("publishes no delta and no slow car yet", () => {
    const d = new Deriver();
    const out = d.next(simState({ tick: 1 }));
    expect(out.delta).toBeNull();
    expect(out.slowCar).toBeNull();
  });

  it("maps the session phase to the fuel tracker's session state", () => {
    const d = new Deriver();
    // Whole laps in 0.1 steps: the tracker treats bigger jumps as tows.
    let tick = 0;
    const lap = (phase: SessionPhase, lapNumber: number): void => {
      for (let i = 0; i < 10; i++) {
        d.next(simState({ phase, tick: ++tick, lap: lapNumber, pct: 0.05 + i * 0.1 }));
      }
      d.next(simState({ phase, tick: ++tick, lap: lapNumber + 1, pct: 0.01 }));
    };
    lap("formation", 0);
    lap("racing", 1);
    lap("racing", 2);
    const [pace, started, racing] = d.fuelTracker.lapRecords;
    expect(pace).toMatchObject({ startState: 3, valid: false, reason: "paceLap" });
    expect(started).toMatchObject({ startState: 3, endState: 4, reason: "paceLap" });
    expect(racing).toMatchObject({ startState: 4, endState: 4 });
  });

  it("excludes pace cars and the player from the gaps and signs them negative when ahead", () => {
    const d = new Deriver();
    const s = simState({ tick: 10, pct: 0.5 });
    const ahead = emptyCar(1);
    const behind = emptyCar(2);
    const pace = emptyCar(3);
    for (const c of [ahead, behind, pace]) {
      c.connected = true;
      c.lapsCompleted = 0;
    }
    ahead.lapDistPct = 0.52;
    behind.lapDistPct = 0.47;
    pace.lapDistPct = 0.6;
    pace.isPaceCar = true;
    s.cars.push(ahead, behind, pace);
    const gaps = d.next(s).gaps;
    expect(gaps.map((g) => g.carIdx)).toEqual([1, 2]);
    expect(gaps[0]?.gapS).toBeLessThan(0);
    expect(gaps[1]?.gapS).toBeGreaterThan(0);
  });

  describe("lap delta", () => {
    const field = (type: "race" | "practice") => {
      const s = simState({ type, tick: 10, lap: 5, pct: 0.98 });
      const cars: [number, number | null, number | null, boolean][] = [
        // carIdx, laps, pct, connected
        [1, 7, 0.02, true], // a lap up, just across the line ahead
        [2, 6, 0.01, true], // same lap, just across the line
        [3, 4, 0.9, true], // a lap down, just behind
        [4, null, 0.5, true], // laps unknown
        [5, 3, 0.5, false], // gone
      ];
      for (const [idx, laps, pct, connected] of cars) {
        const c = emptyCar(idx);
        c.connected = connected;
        c.lapsCompleted = laps;
        c.lapDistPct = pct;
        s.cars.push(c);
      }
      const pit = emptyCar(6);
      pit.connected = true;
      pit.lapsCompleted = 4;
      pit.lapDistPct = 0.95;
      pit.onPitRoad = true;
      s.cars.push(pit);
      return s;
    };

    it("gives each car's whole-lap difference to the player in a race", () => {
      const gaps = new Deriver().next(field("race")).gaps;
      expect(gaps.map((g) => [g.carIdx, g.lapDelta])).toEqual([
        [1, 1],
        [2, 0],
        [3, -1],
        [4, null],
        [5, null],
        [6, -1],
      ]);
    });

    it("is null for every car outside a race", () => {
      const gaps = new Deriver().next(field("practice")).gaps;
      expect(gaps.every((g) => g.lapDelta === null)).toBe(true);
    });
  });

  it("marks gaps unavailable for cars that are not in the world", () => {
    const s = simState({ tick: 10 });
    const away = emptyCar(1);
    s.cars.push(away);
    expect(new Deriver().next(s).gaps).toEqual([
      { carIdx: 1, gapS: null, tier: "unavailable", lapDelta: null },
    ]);
  });

  describe("class indices", () => {
    it("hands out 1, 2, ... on first sight, maps empty to 0 and clears on reset", () => {
      const d = new Deriver();
      expect(d.classIndex("")).toBe(0);
      expect(d.classIndex("Hyper")).toBe(1);
      expect(d.classIndex("LMGT3")).toBe(2);
      expect(d.classIndex("Hyper")).toBe(1);
      d.reset();
      expect(d.classIndex("LMGT3")).toBe(1);
    });

    it("keeps LMU class bests and track references apart", () => {
      const d = new Deriver();
      const specs = [
        { idx: 0, name: "Ava Quill", cls: "Hyper", lapS: 60 },
        { idx: 1, name: "Bo Fenwick", cls: "LMGT3", lapS: 90 },
      ];
      for (let t = 0; t <= 200; t += 0.5) {
        const s = emptySimState("lmu");
        s.connected = true;
        s.tickTimeS = 10 + t;
        s.playerCarIdx = 0;
        s.session.type = "race";
        s.session.phase = "racing";
        s.cars = specs.map(({ idx, name, cls, lapS }) => {
          const car = emptyCar(idx);
          car.connected = true;
          car.driverName = name;
          car.classId = cls;
          car.lapsCompleted = Math.floor(t / lapS);
          car.lapDistPct = (t % lapS) / lapS;
          car.isOnTrack = true;
          return car;
        });
        d.next(s);
      }
      const inputs = (d as unknown as { standingsInputs(): StandingsInputs }).standingsInputs();
      expect(inputs.classBestLapS("Hyper")).toBeCloseTo(60, 0);
      expect(inputs.classBestLapS("LMGT3")).toBeCloseTo(90, 0);
      expect(inputs.trackReference("Hyper")?.lapTimeS).toBeCloseTo(60, 0);
      expect(inputs.trackReference("LMGT3")?.lapTimeS).toBeCloseTo(90, 0);
    });
  });

  describe("session change", () => {
    function feedLaps(d: Deriver, from: number): void {
      d.next(simState({ tick: from, lap: 2, pct: 0.99 }));
      d.next(simState({ tick: from + 1, lap: 3, pct: 0.01 }));
    }

    it("resets when the session type changes, but not when it first becomes known", () => {
      const d = new Deriver();
      const unknown = simState({ tick: 1 });
      unknown.session.type = null;
      d.next(unknown);
      d.next(simState({ type: "race", tick: 2 }));
      expect(d.sessionNum).toBe(0);
      d.next(simState({ type: "practice", tick: 3 }));
      expect(d.sessionNum).toBe(1);
    });

    it("resets when the clock goes back by more than a second, not for less", () => {
      const d = new Deriver();
      feedLaps(d, 100);
      d.next(simState({ tick: 100.5, lap: 3, pct: 0.02 }));
      expect(d.sessionNum).toBe(0);
      d.next(simState({ tick: 50, lap: 3, pct: 0.03 }));
      expect(d.sessionNum).toBe(1);
      expect(d.fuelTracker.lapRecords).toHaveLength(0);
    });

    it("resets on request, for a source switch or a replay restart", () => {
      const d = new Deriver();
      feedLaps(d, 100);
      expect(d.fuelTracker.lapRecords).toHaveLength(1);
      d.reset();
      expect(d.fuelTracker.lapRecords).toHaveLength(0);
      expect(d.sessionNum).toBe(1);
      expect(d.next(simState({ tick: 100, lap: 3 })).fuel).not.toBeNull();
    });
  });
});

const raceStart = `${FIXTURE_DIR}iracing-ferrari-race-start-20s.ovfx`;

describe("end to end on the iRacing race-start slice", () => {
  it("goes formation to racing, records one invalid lap at the S/F crossing and orders gaps", async () => {
    const slice = await loadSlice(raceStart);
    const states = toStates(slice);
    const deriver = new Deriver();

    const phases: string[] = [];
    let crossedAtS: number | null = null;
    let last: Derived = emptyDerived();
    states.forEach((state, i) => {
      last = deriver.next(state);
      const phase = state.session.phase;
      if (phase !== null && phases[phases.length - 1] !== phase) phases.push(phase);
      if (crossedAtS === null && deriver.fuelTracker.lapRecords.length > 0) {
        crossedAtS = slice.ticks[i]?.timeS ?? null;
      }
    });

    expect(phases).toEqual(["formation", "racing"]);
    const records = deriver.fuelTracker.lapRecords;
    expect(records).toHaveLength(1);
    expect(records[0]?.valid).toBe(false);
    expect(["paceLap", "unknownStart"]).toContain(records[0]?.reason);
    expect(crossedAtS).not.toBeNull();
    expect(Math.abs((crossedAtS ?? 0) - 815.77)).toBeLessThan(0.5);
    expect(last.fuel?.validLapCount).toBe(0);

    // Gap order is the order of the cars around the player's lap distance.
    const final = states[states.length - 1] as SimState;
    const player = final.cars.find((c) => c.carIdx === final.playerCarIdx);
    const pp = player?.lapDistPct ?? 0;
    const ahead = (pct: number): number => ((pct - pp + 0.5 + 10) % 1) - 0.5;
    const onTrack = last.gaps
      .map((g) => ({ g, car: final.cars.find((c) => c.carIdx === g.carIdx) }))
      .filter((x) => x.car?.isOnTrack === true && x.car.lapDistPct !== null && x.g.gapS !== null);
    expect(onTrack.length).toBeGreaterThan(3);
    const byGap = [...onTrack].sort((a, b) => (a.g.gapS ?? 0) - (b.g.gapS ?? 0));
    const byPct = [...onTrack].sort(
      (a, b) => ahead(b.car?.lapDistPct ?? 0) - ahead(a.car?.lapDistPct ?? 0),
    );
    expect(byGap.map((x) => x.g.carIdx)).toEqual(byPct.map((x) => x.g.carIdx));
  });
});
