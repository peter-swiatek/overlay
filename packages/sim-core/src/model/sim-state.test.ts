import { describe, expect, it } from "vitest";
import { SIM_STATE_VERSION, emptyCar, emptySimState, isSimState } from "./sim-state";

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
