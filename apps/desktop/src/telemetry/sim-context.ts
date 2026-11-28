import { iracingCarType, type SimState } from "@overlay/sim-core";
import type { SimContext } from "../shared/layout-types";

/**
 * The (game, car, car type, session type) a frame belongs to, for the automatic group switch:
 * the player's car, or the car the camera is on while the player has none (spectating, replay).
 * The car type is iRacing only.
 */
export function simContextOf(state: SimState): SimContext {
  const carIdx = state.playerCarIdx ?? state.focusCarIdx;
  const car = carIdx === null ? undefined : state.cars.find((c) => c.carIdx === carIdx);
  const carName = car?.carName?.trim() || null;
  const carType =
    state.sim === "iracing" && car !== undefined
      ? iracingCarType({
          carName,
          className: car.className,
          carPath: car.carPath ?? null,
          trackCategory: state.session.trackCategory ?? null,
        })
      : null;
  return {
    sim: state.sim,
    carName,
    carType,
    sessionType: state.session.type,
    testData: state.source === "mock" || state.source === "replay",
  };
}
