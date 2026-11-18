/**
 * Browser-safe demo telemetry for the settings preview (`@overlay/sim-core/demo`).
 * Must stay free of `node:` modules and adapters; `pure.test.ts` checks the import graph.
 */
import type { SimState } from "./model";
import { Deriver } from "./telemetry/derive";
import type { TelemetryFrame } from "./telemetry/frame";
import { MockSource } from "./telemetry/mock";

export interface DemoFeedOptions {
  /** Laps simulated at creation so lap times, gaps and fuel averages have values. Default 3. */
  warmUpLaps?: number;
}

export interface DemoFeed {
  /** Advances the simulation by `dtS` seconds and returns the next frame (`seq` counts up). */
  next(dtS: number): TelemetryFrame;
}

/** Player lap time of the mock race, seconds; the warm-up length is derived from it. */
const PLAYER_LAP_S = 100;
/** Warm-up step. Small enough for the lap and gap trackers, large enough to start fast. */
const WARM_UP_STEP_S = 0.25;

/** Invented names, so the demo never shows a real driver. Index 0 is the player. */
const DRIVER_NAMES = [
  "Alex Marlow",
  "Jonas Verhoek",
  "Mira Castellan",
  "Dario Okonkwo",
  "Elin Strand",
  "Tomas Brightwell",
  "Yuki Aramaki",
  "Lena Fontaine",
  "Pavel Drozdov",
  "Nadia Quill",
  "Hugo Ferreira",
  "Sofia Lindqvist",
  "Ruben Achterberg",
  "Ines Valcourt",
  "Kasper Holm",
  "Amara Nwosu",
  "Luca Benedetti",
  "Freya Ashdown",
  "Mateo Quintero",
  "Greta Halvorsen",
];

function withInventedNames(state: SimState): SimState {
  for (const car of state.cars) {
    car.driverName = DRIVER_NAMES[car.carIdx % DRIVER_NAMES.length] ?? `Driver ${car.carIdx}`;
  }
  return state;
}

/**
 * A deterministic demo race: the mock source run through the real deriver, fast-forwarded at
 * creation. The same sequence of `next` calls always gives the same frames.
 */
export function createDemoFeed(options: DemoFeedOptions = {}): DemoFeed {
  const warmUpLaps = Math.max(0, options.warmUpLaps ?? 3);
  const source = new MockSource();
  const deriver = new Deriver();
  let seq = 0;

  const advance = (dtS: number): TelemetryFrame => {
    const state = withInventedNames(source.step(dtS));
    return {
      seq: ++seq,
      source: "mock",
      status: "live",
      error: null,
      state,
      derived: deriver.next(state),
    };
  };

  const warmUpS = warmUpLaps * PLAYER_LAP_S;
  for (let t = 0; t < warmUpS; t += WARM_UP_STEP_S) advance(WARM_UP_STEP_S);
  seq = 0;

  return { next: advance };
}
