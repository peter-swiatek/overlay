import { describe, expect, it } from "vitest";
import { isSimState } from "../model";
import { Deriver } from "./derive";
import { MockSource } from "./mock";

describe("MockSource", () => {
  it("produces valid SimState frames with two classes and a fuel-burning player", () => {
    const mock = new MockSource();
    const first = mock.state();
    expect(isSimState(first)).toBe(true);
    expect(first.source).toBe("mock");
    expect(first.cars).toHaveLength(20);
    expect(new Set(first.cars.map((c) => c.classId)).size).toBe(2);
    expect(first.playerCarIdx).toBe(0);

    let last = first;
    for (let i = 0; i < 2000; i++) {
      last = mock.step(0.1);
      expect(isSimState(last)).toBe(true);
    }
    expect(last.player.fuelL).not.toBe(first.player.fuelL);
    expect(last.tickTimeS).toBeCloseTo(200, 6);
    expect(new Set(last.cars.map((c) => c.position)).size).toBe(20);
    for (const car of last.cars) {
      expect(car.lapDistPct).toBeGreaterThanOrEqual(0);
      expect(car.lapDistPct).toBeLessThan(1);
    }
  });

  it("is deterministic and survives structuredClone", () => {
    const a = new MockSource();
    const b = new MockSource();
    for (let i = 0; i < 500; i++) {
      a.step(1 / 60);
      b.step(1 / 60);
    }
    expect(a.state()).toEqual(b.state());
    expect(structuredClone(a.state())).toEqual(a.state());
  });

  it("gives the fuel tracker valid laps to work with", () => {
    const mock = new MockSource();
    const deriver = new Deriver();
    let derived = deriver.next(mock.state());
    for (let i = 0; i < 4000; i++) derived = deriver.next(mock.step(0.1));
    expect(derived.fuel?.validLapCount).toBeGreaterThanOrEqual(2);
    expect(derived.fuel?.fuelAvgLap).toBeCloseTo(2.4, 1);
    const state = mock.state();
    const player = state.cars[0];
    const lapsToGo = 40 - (player?.lapsCompleted ?? 0) - (player?.lapDistPct ?? 0);
    expect(derived.fuel?.fuelDelta).toBeCloseTo(
      (state.player.fuelL ?? 0) - lapsToGo * (derived.fuel?.fuelAvgLap ?? 0),
      6,
    );
    expect(derived.gaps).toHaveLength(19);
  });

  it("fills the design-system fields every frame", () => {
    const mock = new MockSource();
    let sawAbs = false;
    let sawOffTrack = false;
    let sawYellow = false;
    let sawNotOk = false;
    let sawP2pActive = false;
    for (let i = 0; i < 1500; i++) {
      const st = mock.step(0.1);
      const p = st.player;
      expect(p.lap?.currentLapS).not.toBeNull();
      expect(p.lap?.delta?.best?.rate).not.toBeNull();
      expect(p.shiftLights).toEqual({
        firstRpm: 5200,
        shiftRpm: 7600,
        lastRpm: 7400,
        blinkRpm: 7800,
      });
      expect(p.redlineRpm).toBe(8000);
      expect(p.steerMaxRad).toBe(7.85);
      expect(p.isOnTrack).toBe(true);
      expect(["onTrack", "approachingPits"]).toContain(p.trackSurface);
      expect(p.absActive === (p.inputs.brake ?? 0) > 0.8).toBe(true);
      expect(st.session.typeName).toBe("Race");
      expect(st.session.trackUsage).toBe("moderate usage");
      expect(st.conditions.declaredWet).toBe(false);
      expect(st.conditions.humidity).not.toBeNull();
      expect(st.conditions.windSpeedMps).not.toBeNull();
      expect(st.cars[7]?.flags?.repair).toBe(true);
      sawAbs ||= p.absActive === true;
      sawNotOk ||= p.lap?.delta?.sessionBest?.ok === false;
      sawOffTrack ||= st.cars.some((c) => c.trackSurface === "offTrack");
      sawYellow ||= st.cars[3]?.flags?.yellow === true;
      for (const car of st.cars) {
        expect(car.flags).not.toBeNull();
        expect(car.trackSurface).not.toBeNull();
        if (car.classId === "2") {
          expect(car.p2pCount).toBeGreaterThanOrEqual(0);
          expect(car.p2pCount).toBeLessThanOrEqual(10);
          sawP2pActive ||= car.p2pActive === true;
        } else {
          expect(car.p2pCount).toBeNull();
          expect(car.p2pActive).toBeNull();
        }
      }
    }
    expect([sawAbs, sawNotOk, sawOffTrack, sawYellow, sawP2pActive]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  }, 20_000);

  it("derives delta rate from the delta value", () => {
    const mock = new MockSource();
    mock.step(30);
    const a = mock.state().player.lap?.delta?.best;
    const dt = 0.001;
    const b = mock.step(dt).player.lap?.delta?.best;
    expect(((b?.s ?? 0) - (a?.s ?? 0)) / dt).toBeCloseTo(a?.rate ?? 0, 1);
  });
  it("derives gear and rpm from speed, reaching the shift and blink points", () => {
    const mock = new MockSource();
    const gears = new Set<number>();
    let maxRpm = 0;
    for (let i = 0; i < 600; i++) {
      const p = mock.step(0.1).player;
      const speed = p.speedMps ?? 0;
      const gear = speed < 30 ? 3 : speed < 38 ? 4 : speed < 46 ? 5 : 6;
      expect(p.gear).toBe(gear);
      expect(p.rpm).toBeGreaterThanOrEqual(5000);
      expect(p.rpm).toBeLessThanOrEqual(8000);
      gears.add(p.gear ?? 0);
      maxRpm = Math.max(maxRpm, p.rpm ?? 0);
    }
    expect([...gears].sort()).toEqual([3, 4, 5, 6]);
    expect(maxRpm).toBeGreaterThan(7800);
  });

  it("presses the clutch only near the start of a gear band", () => {
    const mock = new MockSource();
    let pressed = 0;
    for (let i = 0; i < 1200; i++) {
      const p = mock.step(0.1).player;
      if (p.inputs?.clutch === 1) {
        pressed++;
        expect(p.rpm).toBeLessThan(5000 + 3000 * 0.05 + 1e-9);
      } else {
        expect(p.inputs?.clutch).toBe(0);
        expect(p.rpm).toBeGreaterThanOrEqual(5000 + 3000 * 0.05 - 1e-9);
      }
    }
    expect(pressed).toBeGreaterThan(0);
  });

  it("turns the heading once per lap and has no rain or fog", () => {
    const mock = new MockSource();
    for (let i = 0; i < 300; i++) {
      const st = mock.step(0.5);
      const fraction = (st.cars[0]?.lapDistPct ?? 0) as number;
      expect(st.player.yawRad).toBeCloseTo(2 * Math.PI * fraction, 9);
      expect(st.conditions.precipitation).toBe(0);
      expect(st.conditions.fogLevel).toBe(0);
    }
  });

  it("opens a pit approach window every lap without putting the car on pit road", () => {
    const mock = new MockSource();
    let limiterSteps = 0;
    for (let i = 0; i < 1000; i++) {
      const st = mock.step(0.5);
      const f = st.cars[0]?.lapDistPct ?? 0;
      const inWindow = f >= 0.9 && f < 0.95;
      expect(st.player.pitStallLapDistPct).toBe(0.95);
      expect(st.player.pitLimiter).toBe(inWindow);
      expect(st.player.trackSurface).toBe(inWindow ? "approachingPits" : "onTrack");
      expect(st.cars[0]?.onPitRoad).toBe(false);
      if (inWindow) limiterSteps++;
    }
    expect(limiterSteps).toBeGreaterThan(0);
  });

  it("varies the player's lap times and tracks the best", () => {
    const mock = new MockSource();
    const expected = [100.3, 99.8, 99.5, 99.6, 100.2, 100.3, 99.8];
    const seen = new Map<number, number | null>();
    const best = new Map<number, number | null>();
    for (let i = 0; i < 7200; i++) {
      const st = mock.step(0.1);
      const laps = st.cars[0]?.lapsCompleted ?? 0;
      seen.set(laps, st.player.lap?.lastLapS ?? null);
      best.set(laps, st.player.lap?.bestLapS ?? null);
    }
    expect(seen.get(0)).toBeNull();
    expect(best.get(0)).toBeNull();
    expected.forEach((time, k) => expect(seen.get(k + 1)).toBeCloseTo(time, 9));
    expect(best.get(1)).toBeCloseTo(100.3, 9);
    expect(best.get(2)).toBeCloseTo(99.8, 9);
    expect(best.get(3)).toBeCloseTo(99.5, 9);
    expect(best.get(7)).toBeCloseTo(99.5, 9);
    // The other cars' lap times are unchanged.
    expect(mock.state().cars[0]?.lastLapS).toBe(100);
  });

  it("makes lap 3 the only unclean lap", () => {
    const mock = new MockSource();
    for (let i = 0; i < 1500; i++) {
      const st = mock.step(0.2);
      const d = (st.cars[0]?.lapsCompleted ?? 0) + (st.cars[0]?.lapDistPct ?? 0);
      expect(st.player.incidentCount).toBe(d >= 2.5 ? 2 : 0);
    }
  });
});
