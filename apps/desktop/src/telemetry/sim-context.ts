import type { SimState } from "@overlay/sim-core";
import type { SimContext } from "../shared/layout-types";

/**
 * The (sim, car, session type) a frame belongs to, for the automatic layout switch: the player's
 * car, or the car the camera is on while the player has none (spectating, replay).
 */
export function simContextOf(state: SimState): SimContext {
  const carIdx = state.playerCarIdx ?? state.focusCarIdx;
  const car = carIdx === null ? undefined : state.cars.find((c) => c.carIdx === carIdx);
  const carName = car?.carName?.trim() || null;
  return { sim: state.sim, carName, sessionType: state.session.type };
}
