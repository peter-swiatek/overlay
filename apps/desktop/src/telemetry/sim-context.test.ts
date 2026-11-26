import { describe, expect, it } from "vitest";
import { emptySimState, type Car, type SimState } from "@overlay/sim-core";
import { simContextOf } from "./sim-context";

function stateWith(patch: Partial<SimState>, cars: Partial<Car>[] = []): SimState {
  const base = emptySimState("iracing");
  return {
    ...base,
    ...patch,
    cars: cars.map((c, i) => ({ ...(base.cars[0] ?? ({} as Car)), carIdx: i, ...c }) as Car),
  };
}

describe("simContextOf", () => {
  it("takes the sim, the player's car name and the session type", () => {
    const state = stateWith({ sim: "iracing", playerCarIdx: 1, focusCarIdx: 0 }, [
      { carName: "Other car" },
      { carName: " Mercedes-AMG GT3 2020 " },
    ]);
    state.session = { ...state.session, type: "qualifying" };
    expect(simContextOf(state)).toEqual({
      sim: "iracing",
      carName: "Mercedes-AMG GT3 2020",
      sessionType: "qualifying",
    });
  });

  it("uses the car the camera is on when the player has none", () => {
    const state = stateWith({ sim: "lmu", playerCarIdx: null, focusCarIdx: 0 }, [
      { carName: "Porsche 963" },
    ]);
    expect(simContextOf(state).carName).toBe("Porsche 963");
  });

  it("gives null for an unknown car", () => {
    const state = stateWith({ sim: "lmu", playerCarIdx: 4, focusCarIdx: null }, [{ carName: "" }]);
    expect(simContextOf(state)).toEqual({ sim: "lmu", carName: null, sessionType: null });
  });
});
