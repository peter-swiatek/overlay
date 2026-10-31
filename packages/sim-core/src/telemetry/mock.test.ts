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
});
