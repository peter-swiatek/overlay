/** Types for the in-app CPU budget check (Developer page). */

/** The target for the extra CPU the M2 overlays cost, in % of the whole machine. */
export const CPU_BUDGET_PCT = 3;

/** The overlays that make up phase B. */
export const PERF_OVERLAY_IDS = [
  "leaderboard",
  "relative",
  "spotter",
  "pit-speed",
  "fuel",
] as const;

export type PerfPhaseId = "A" | "B";

export interface PerfTypeStats {
  meanPct: number;
  p95Pct: number;
}

export interface PerfPhaseSummary {
  id: PerfPhaseId;
  label: string;
  /** Overlay ids that were open during the phase. */
  overlays: string[];
  seconds: number;
  samples: number;
  /** Whole-machine CPU %, all processes together. */
  meanPct: number;
  p95Pct: number;
  /** Per process type (see metricKey). */
  byType: Record<string, PerfTypeStats>;
}

export interface PerfTypeDelta {
  type: string;
  aMeanPct: number;
  bMeanPct: number;
  deltaPct: number;
}

export interface PerfCheckResult {
  version: 1;
  startedAt: string;
  finishedAt: string;
  cores: number;
  source: string;
  phaseA: PerfPhaseSummary;
  phaseB: PerfPhaseSummary;
  /** Mean of phase B minus mean of phase A: the budget figure. */
  budgetPct: number;
  /** p95 of phase B minus p95 of phase A, for information. */
  p95DiffPct: number;
  targetPct: number;
  pass: boolean;
  /** Process types, heaviest increase first. */
  byType: PerfTypeDelta[];
  heaviest: PerfTypeDelta | null;
  suggestions: string[];
  /** Where the JSON was saved; set by main after saving. */
  file?: string;
}

export interface PerfProgress {
  phase: PerfPhaseId | "settle" | "restore";
  /** The phase this step belongs to. */
  phaseId: PerfPhaseId;
  label: string;
  elapsedS: number;
  totalS: number;
  /** Seconds already done over all phases, and in total. */
  overallDoneS: number;
  overallTotalS: number;
}

export type PerfCheckOutcome =
  | { status: "done"; result: PerfCheckResult }
  | { status: "cancelled" }
  | { status: "error"; error: string };
