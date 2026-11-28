/*
 * Overlay groups (stored as "layouts"): each one holds the window bounds and the on/off state of
 * every overlay instance, plus conditions that say when it is picked automatically. Overlay
 * options stay shared.
 */

import type { CarType, SessionType, SimName } from "@overlay/sim-core/types";

/** Id of the fallback group ("Everything else"), used when no other one matches; never deleted. */
export const DEFAULT_LAYOUT_ID = "default";

export const FALLBACK_GROUP_NAME = "Everything else";

export const LAYOUT_SIMS: readonly SimName[] = ["iracing", "lmu"];

export const LAYOUT_SESSION_TYPES: readonly SessionType[] = [
  "practice",
  "qualifying",
  "race",
  "warmup",
  "other",
];

export const SIM_LABELS: Readonly<Record<SimName, string>> = {
  iracing: "iRacing",
  lmu: "Le Mans Ultimate",
};

export const SESSION_TYPE_LABELS: Readonly<Record<SessionType, string>> = {
  practice: "Practice",
  qualifying: "Qualifying",
  race: "Race",
  warmup: "Warmup",
  other: "Testing",
};

export const CAR_TYPES: readonly CarType[] = ["formula", "sports", "oval", "dirt"];

export const CAR_TYPE_LABELS: Readonly<Record<CarType, string>> = {
  formula: "Formula",
  sports: "Sports car",
  oval: "Oval",
  dirt: "Dirt",
};

/** When a group is picked automatically. Null or an empty list means "any". */
export interface LayoutMatch {
  game: SimName | null;
  sessions: SessionType[];
  /** iRacing only: empty for a Le Mans Ultimate group. */
  carTypes: CarType[];
  /** Specific car names as the sim reports them for the player's car. */
  cars: string[];
}

/** What the automatic switch looks at: the sim, the player's car and the session type. */
export interface SimContext {
  sim: SimName | null;
  carName: string | null;
  /** iRacing only; null for Le Mans Ultimate and while unknown. */
  carType: CarType | null;
  sessionType: SessionType | null;
  /** The frames come from test data (mock or a replayed recording). */
  testData: boolean;
}

export const EMPTY_SIM_CONTEXT: SimContext = {
  sim: null,
  carName: null,
  carType: null,
  sessionType: null,
  testData: false,
};

export function sameSimContext(a: SimContext, b: SimContext): boolean {
  return (
    a.sim === b.sim &&
    a.carName === b.carName &&
    a.carType === b.carType &&
    a.sessionType === b.sessionType &&
    a.testData === b.testData
  );
}

/** True when nothing is known (no sim connected). */
export function isEmptySimContext(context: SimContext): boolean {
  return (
    context.sim === null &&
    context.carName === null &&
    context.carType === null &&
    context.sessionType === null
  );
}

/** A group as the main window lists it. */
export interface LayoutView {
  id: string;
  name: string;
  /** The fallback group ("Everything else"). */
  isDefault: boolean;
  match: LayoutMatch;
  /** Instance id to on/off in this group (missing means off). */
  enabled: Record<string, boolean>;
}

export interface LayoutsState {
  layouts: LayoutView[];
  activeId: string;
  /** Switch layouts when the sim, the car or the session type changes. */
  autoSwitch: boolean;
  context: SimContext;
}

/** Whether an overlay offered for `sims` (its manifest's list) is offered in a group for `game`. */
export function offeredForGame(sims: readonly SimName[], game: SimName | null): boolean {
  return game === null || sims.includes(game);
}

/** Longest layout name kept. */
export const MAX_LAYOUT_NAME = 40;
/** Most car names one layout keeps. */
export const MAX_LAYOUT_CARS = 50;
/** Longest car name kept. */
export const MAX_CAR_NAME = 80;
