/*
 * Saved layouts: each one holds the window bounds and the on/off state of every overlay
 * instance, plus tags that say when it is picked automatically. Overlay options stay shared.
 */

import type { SessionType, SimName } from "@overlay/sim-core/types";

/** Id of the layout used when no other one matches; it cannot be deleted. */
export const DEFAULT_LAYOUT_ID = "default";

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
  other: "Testing / other",
};

/** When a layout is picked automatically. An empty list means "any". */
export interface LayoutMatch {
  sims: SimName[];
  /** Car names as the sim reports them for the player's car. */
  cars: string[];
  sessions: SessionType[];
}

/** What the automatic switch looks at: the sim, the player's car and the session type. */
export interface SimContext {
  sim: SimName | null;
  carName: string | null;
  sessionType: SessionType | null;
}

export const EMPTY_SIM_CONTEXT: SimContext = { sim: null, carName: null, sessionType: null };

export function sameSimContext(a: SimContext, b: SimContext): boolean {
  return a.sim === b.sim && a.carName === b.carName && a.sessionType === b.sessionType;
}

/** True when nothing is known (no sim connected). */
export function isEmptySimContext(context: SimContext): boolean {
  return context.sim === null && context.carName === null && context.sessionType === null;
}

/** A layout as the main window lists it. */
export interface LayoutView {
  id: string;
  name: string;
  isDefault: boolean;
  match: LayoutMatch;
  /** How many overlay windows the layout switches on. */
  overlayCount: number;
}

export interface LayoutsState {
  layouts: LayoutView[];
  activeId: string;
  /** Switch layouts when the sim, the car or the session type changes. */
  autoSwitch: boolean;
  context: SimContext;
}

/** Longest layout name kept. */
export const MAX_LAYOUT_NAME = 40;
/** Most car names one layout keeps. */
export const MAX_LAYOUT_CARS = 50;
/** Longest car name kept. */
export const MAX_CAR_NAME = 80;
