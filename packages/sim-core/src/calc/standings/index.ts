import type { SimState } from "../../model";
import type { Standings, StandingsInputs } from "./types";

export * from "./types";

/** Stub: the standings ticket computes real values. */
export class StandingsTracker {
  reset(): void {}

  next(state: SimState, inputs: StandingsInputs): Standings | null {
    void state;
    void inputs;
    return null;
  }
}
