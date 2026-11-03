import { describe, expect, it } from "vitest";
import { SIM_STATE_VERSION, emptyCar, emptyFlags, emptySimState, isSimState } from "./sim-state";

describe("SimState", () => {
  it("starts empty with unknowns as null and survives a JSON round trip", () => {
    const state = emptySimState("iracing");
    expect(state.version).toBe(SIM_STATE_VERSION);
    expect(state.connected).toBe(false);
    expect(state.player.fuelL).toBeNull();
    expect(state.session.timeRemainingS).toBeNull();
    expect(state.flags).toBeNull();
    const copy: unknown = JSON.parse(JSON.stringify(state));
    expect(copy).toEqual(state);
    expect(isSimState(copy)).toBe(true);
  });

  it("has the track and position fields empty, and tolerates data from before `sim`", () => {
    const state = emptySimState("replay");
    expect(state.sim).toBeNull();
    expect(state.session.trackConfig).toBeNull();
    expect(state.player.worldPos).toBeNull();
    expect(state.player.yawRad).toBeNull();
    expect(state.player.velocityMps).toBeNull();
    const old: Record<string, unknown> = { ...state };
    delete old["sim"];
    expect(isSimState(old)).toBe(true);
    expect(isSimState({ ...state, sim: "lmu" })).toBe(true);
    expect(isSimState({ ...state, sim: "acc" })).toBe(false);
  });

  it("has every added field present with its null or false default", () => {
    const state = emptySimState("iracing");
    expect(state.session.typeName).toBeNull();
    expect(state.session.trackUsage).toBeNull();
    expect(state.conditions.declaredWet).toBeNull();
    const p = state.player;
    expect(p.lap).toBeNull();
    expect(p.absActive).toBeNull();
    expect(p.trackSurface).toBeNull();
    expect(p.isOnTrack).toBeNull();
    expect(p.shiftLights).toBeNull();
    expect(p.redlineRpm).toBeNull();
    expect(p.steerMaxRad).toBeNull();
    for (const key of ["lap", "absActive", "trackSurface", "isOnTrack", "shiftLights"]) {
      expect(p).toHaveProperty(key);
    }
    const car = emptyCar(0);
    expect(car.flags).toBeNull();
    expect(car.p2pCount).toBeNull();
    expect(car.p2pActive).toBeNull();
    expect(car.trackSurface).toBeNull();
    for (const key of ["flags", "p2pCount", "p2pActive", "trackSurface"]) {
      expect(car).toHaveProperty(key);
    }
    const flags = emptyFlags();
    expect(flags.disqualified).toBe(false);
    expect(flags.repair).toBe(false);
    expect(flags.furled).toBe(false);
  });

  it("passes isSimState and survives a JSON round trip with a car", () => {
    const state = emptySimState("lmu");
    state.cars.push(emptyCar(2));
    const copy: unknown = JSON.parse(JSON.stringify(state));
    expect(copy).toEqual(state);
    expect(isSimState(copy)).toBe(true);
    expect(isSimState(emptySimState())).toBe(true);
  });

  it("accepts a state with cars", () => {
    const state = emptySimState("lmu");
    state.cars.push(emptyCar(3));
    expect(isSimState(state)).toBe(true);
  });

  it("rejects values that are not a current SimState", () => {
    expect(isSimState(null)).toBe(false);
    expect(isSimState("x")).toBe(false);
    expect(isSimState({ ...emptySimState(), version: 0 })).toBe(false);
    expect(isSimState({ ...emptySimState(), source: "rfactor" })).toBe(false);
    expect(isSimState({ ...emptySimState(), cars: [{ carIdx: "1" }] })).toBe(false);
    expect(isSimState({ ...emptySimState(), player: null })).toBe(false);
  });
});
