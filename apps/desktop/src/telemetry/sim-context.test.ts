import { describe, expect, it } from "vitest";
import { emptySimState, type Car, type SimState } from "@overlay/sim-core";
import { simContextOf } from "./sim-context";

function stateWith(patch: Partial<SimState>, cars: Partial<Car>[] = []): SimState {
  const base = emptySimState("iracing");
  return {
    ...base,
    ...patch,
    cars: cars.map((c, i) => ({ carIdx: i, ...c }) as Car),
  };
}

describe("simContextOf", () => {
  it("takes the sim, the player's car, its car type and the session type", () => {
    const state = stateWith({ sim: "iracing", playerCarIdx: 1, focusCarIdx: 0 }, [
      { carName: "Other car" },
      { carName: " Mercedes-AMG GT3 2020 ", className: "GT3", carPath: "mercedesamgevogt3" },
    ]);
    state.session = { ...state.session, type: "qualifying", trackCategory: "road" };
    expect(simContextOf(state)).toEqual({
      sim: "iracing",
      carName: "Mercedes-AMG GT3 2020",
      carType: "sports",
      sessionType: "qualifying",
      testData: false,
    });
  });

  it("derives Formula, Oval and Dirt for iRacing", () => {
    const f3 = stateWith({ sim: "iracing", playerCarIdx: 0 }, [{ carName: "Dallara F3" }]);
    expect(simContextOf(f3).carType).toBe("formula");
    f3.session = { ...f3.session, trackCategory: "oval" };
    expect(simContextOf(f3).carType).toBe("oval");
    f3.session = { ...f3.session, trackCategory: "dirtRoad" };
    expect(simContextOf(f3).carType).toBe("dirt");
  });

  it("uses the car the camera is on when the player has none", () => {
    const state = stateWith({ sim: "lmu", playerCarIdx: null, focusCarIdx: 0 }, [
      { carName: "Porsche 963" },
    ]);
    expect(simContextOf(state).carName).toBe("Porsche 963");
  });

  it("gives no car type for Le Mans Ultimate and null for an unknown car", () => {
    const state = stateWith({ sim: "lmu", playerCarIdx: 4, focusCarIdx: null }, [{ carName: "" }]);
    expect(simContextOf(state)).toEqual({
      sim: "lmu",
      carName: null,
      carType: null,
      sessionType: null,
      testData: false,
    });
  });

  it("marks mock and replayed frames as test data", () => {
    expect(simContextOf({ ...emptySimState("mock"), sim: null }).testData).toBe(true);
    expect(simContextOf({ ...emptySimState("replay"), sim: "iracing" }).testData).toBe(true);
  });
});
