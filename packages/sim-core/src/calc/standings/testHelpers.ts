import { emptyCar, emptySimState, type Car, type SimState } from "../../model";
import { GAP_MINI_SECTOR_COUNT, type GapReferenceLap } from "../gaps";
import type { StandingsInputs } from "./types";

export type CarSpec = Partial<Car> & { carIdx: number };

export function mkCar(spec: CarSpec): Car {
  return { ...emptyCar(spec.carIdx), connected: true, lapsCompleted: 0, ...spec };
}

export function mkState(cars: CarSpec[], session: Partial<SimState["session"]> = {}): SimState {
  const s = emptySimState("mock");
  s.connected = true;
  s.cars = cars.map(mkCar);
  s.session = { ...s.session, type: "race", phase: "racing", ...session };
  return s;
}

/** A reference lap with constant speed. */
export function linearReference(lapTimeS: number): GapReferenceLap {
  const times: number[] = [];
  for (let i = 0; i <= GAP_MINI_SECTOR_COUNT; i++) {
    times.push((i / GAP_MINI_SECTOR_COUNT) * lapTimeS);
  }
  return { lapTimeS, times };
}

export function mkInputs(over: Partial<StandingsInputs> = {}): StandingsInputs {
  return {
    carReference: () => undefined,
    trackReference: () => undefined,
    averageLapS: () => undefined,
    bestLapS: () => undefined,
    classBestLapS: () => undefined,
    sessionBestLapS: () => undefined,
    ...over,
  };
}
