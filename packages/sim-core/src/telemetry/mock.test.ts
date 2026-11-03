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
      expect(p.trackSurface).toBe("onTrack");
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
});
