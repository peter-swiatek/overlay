import type { SimState } from "../../model";
import type { Proximity } from "./types";

export * from "./types";

/** Stub: the proximity ticket computes real values. */
export class ProximityTracker {
  reset(): void {}

  next(state: SimState): Proximity | null {
    void state;
    return null;
  }
}
