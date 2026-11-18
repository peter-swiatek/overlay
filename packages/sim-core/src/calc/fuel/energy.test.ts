import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type SimState } from "../../model";
import { Deriver } from "../../telemetry/derive";

const TICKS_PER_LAP = 20;

/** An LMU-like player driving 20 ticks per lap; `energyPct` null means a car without energy. */
function lmuState(tick: number, energyPct: number | null): SimState {
  const s = emptySimState("lmu");
  s.connected = true;
  s.tickTimeS = tick;
  s.playerCarIdx = 0;
  s.session.type = "race";
  s.session.phase = "racing";
  s.session.timing = "laps";
  s.session.lapsTotal = 30;
  const car = emptyCar(0);
  car.connected = true;
  car.lapsCompleted = Math.floor(tick / TICKS_PER_LAP);
  car.lapDistPct = (tick % TICKS_PER_LAP) / TICKS_PER_LAP;
  car.isOnTrack = true;
  s.cars = [car];
  s.player.fuelL = 60;
  s.player.fuelCapacityL = 90;
  s.player.energyFraction = energyPct === null ? null : energyPct / 100;
  return s;
}

/** 3.6 percent of energy a lap. */
const energyAt = (tick: number): number => 100 - tick * 0.18;

describe("LMU virtual energy tracker", () => {
  it("averages energy use per lap in percent", () => {
    const d = new Deriver();
    let out = d.next(lmuState(0, energyAt(0)));
    for (let t = 1; t <= 5 * TICKS_PER_LAP; t++) out = d.next(lmuState(t, energyAt(t)));
    expect(out.energy?.validLapCount).toBe(5);
    expect(out.energy?.fuelAvgLap).toBeCloseTo(3.6, 3);
    expect(out.energy?.tankCapacityL).toBe(100);
    expect(out.energy?.lapsRemainingAvg).toBeCloseTo(82 / 3.6, 2);
    expect(out.energy?.stintLaps).toBe(5);
    expect(out.energy?.lapsToGo).toBeCloseTo(25, 6);
  });

  it("is null for a car without virtual energy, while fuel still works", () => {
    const d = new Deriver();
    let out = d.next(lmuState(0, null));
    for (let t = 1; t <= 3 * TICKS_PER_LAP; t++) out = d.next(lmuState(t, null));
    expect(out.energy).toBeNull();
    expect(out.fuel).not.toBeNull();
  });

  it("forgets everything on reset", () => {
    const d = new Deriver();
    for (let t = 0; t <= 3 * TICKS_PER_LAP; t++) d.next(lmuState(t, energyAt(t)));
    d.reset();
    const out = d.next(lmuState(0, 100));
    expect(out.energy?.validLapCount).toBe(0);
    expect(out.energy?.stintLaps).toBe(0);
  });

  it("a refuel of energy starts a new stint and stays out of the average", () => {
    const d = new Deriver();
    let out = d.next(lmuState(0, energyAt(0)));
    for (let t = 1; t <= 3 * TICKS_PER_LAP; t++) out = d.next(lmuState(t, energyAt(t)));
    // Topped up to 100 %, then two more laps at the same rate.
    for (let t = 3 * TICKS_PER_LAP + 1; t <= 5 * TICKS_PER_LAP; t++) {
      out = d.next(lmuState(t, 100 - (t - 3 * TICKS_PER_LAP) * 0.18));
    }
    expect(out.energy?.stintLaps).toBe(2);
    expect(out.energy?.fuelAvgLap).toBeCloseTo(3.6, 3);
  });
});
