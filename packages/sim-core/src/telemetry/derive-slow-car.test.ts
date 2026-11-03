import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type SimState } from "../model";
import { Deriver } from "./derive";
import { MockSource } from "./mock";

/** The player drives at 50 m/s towards a car that runs at 40 m/s for 0.5 s, then stops. */
function frame(tick: number, type: "race" | "practice" = "race"): SimState {
  const s = emptySimState("iracing");
  s.connected = true;
  s.tickTimeS = tick * 0.1;
  s.session.type = type;
  s.session.phase = "racing";
  s.session.trackLengthM = 4000;
  s.playerCarIdx = 0;
  const base = { connected: true, isOnTrack: true, onPitRoad: false, inPitStall: false };
  s.cars = [
    { ...emptyCar(0), ...base, lapDistPct: 0.2 + tick * 0.00125 },
    { ...emptyCar(1), ...base, lapDistPct: 0.27 + Math.min(tick, 5) * 0.001 },
  ];
  return s;
}

describe("Deriver slow car", () => {
  it("publishes the detector's result", () => {
    const d = new Deriver();
    let out = d.next(frame(0));
    expect(out.slowCar).toBeNull();
    for (let i = 1; i <= 20; i++) out = d.next(frame(i));
    expect(out.slowCar).toMatchObject({ carIdx: 1, stopped: true });
    expect(out.slowCar!.distanceM).toBeGreaterThan(0);
  });

  it("resets on a session change", () => {
    const d = new Deriver();
    for (let i = 0; i <= 20; i++) d.next(frame(i));
    const out = d.next(frame(21, "practice"));
    expect(out.slowCar).toBeNull();
  });

  it("resets with the Deriver", () => {
    const d = new Deriver();
    for (let i = 0; i <= 20; i++) d.next(frame(i));
    d.reset();
    expect(d.next(frame(21)).slowCar).toBeNull();
  });

  it("gives slowCar null on the demo feed", () => {
    const mock = new MockSource();
    const d = new Deriver();
    for (let i = 0; i < 300; i++) {
      expect(d.next(mock.step(0.1)).slowCar).toBeNull();
    }
  });
});
