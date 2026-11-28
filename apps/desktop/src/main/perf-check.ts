import { metricKey, type RawProcessMetric } from "./metrics";
import {
  CPU_BUDGET_PCT,
  PERF_OVERLAY_IDS,
  type PerfCheckOutcome,
  type PerfCheckResult,
  type PerfPhaseId,
  type PerfPhaseSummary,
  type PerfProgress,
  type PerfTypeDelta,
} from "../shared/perf-types";

/** Pure logic of the CPU budget check; the Electron wiring is in ipc/developer.ts. */

export const PHASE_SECONDS = 60;
export const SETTLE_SECONDS = 3;
export const SAMPLE_INTERVAL_MS = 1000;

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Nearest-rank percentile of unsorted values (p in 0..1); 0 for no values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

/** Electron reports percentCPUUsage per core (100 = one core); this gives % of the whole machine. */
export function perCoreToMachinePct(percentCPUUsage: number, cores: number): number {
  return percentCPUUsage / Math.max(1, cores);
}

/** One second's reading: whole-machine % in total and per process type. */
export interface CpuSample {
  total: number;
  byType: Record<string, number>;
}

export function sampleFromMetrics(raw: readonly RawProcessMetric[], cores: number): CpuSample {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const m of raw) {
    const pct = perCoreToMachinePct(m.cpu.percentCPUUsage, cores);
    const key = metricKey(m);
    byType[key] = (byType[key] ?? 0) + pct;
    total += pct;
  }
  return { total, byType };
}

export function summarizePhase(
  id: PerfPhaseId,
  label: string,
  overlays: readonly string[],
  samples: readonly CpuSample[],
  seconds: number,
): PerfPhaseSummary {
  const types = new Set<string>();
  for (const s of samples) for (const t of Object.keys(s.byType)) types.add(t);
  const byType: PerfPhaseSummary["byType"] = {};
  for (const type of [...types].sort()) {
    // A type missing from a sample (process gone) counts as 0 for that second.
    const series = samples.map((s) => s.byType[type] ?? 0);
    byType[type] = { meanPct: round(mean(series)), p95Pct: round(percentile(series, 0.95)) };
  }
  const totals = samples.map((s) => s.total);
  return {
    id,
    label,
    overlays: [...overlays],
    seconds,
    samples: samples.length,
    meanPct: round(mean(totals)),
    p95Pct: round(percentile(totals, 0.95)),
    byType,
  };
}

export function compareTypes(a: PerfPhaseSummary, b: PerfPhaseSummary): PerfTypeDelta[] {
  const types = new Set([...Object.keys(a.byType), ...Object.keys(b.byType)]);
  return [...types]
    .map((type) => {
      const aMeanPct = a.byType[type]?.meanPct ?? 0;
      const bMeanPct = b.byType[type]?.meanPct ?? 0;
      return { type, aMeanPct, bMeanPct, deltaPct: round(bMeanPct - aMeanPct) };
    })
    .sort((x, y) => y.deltaPct - x.deltaPct || x.type.localeCompare(y.type));
}

export function suggestionsFor(
  budgetPct: number,
  heaviest: PerfTypeDelta | null,
  targetPct = CPU_BUDGET_PCT,
): string[] {
  if (budgetPct <= targetPct) return [];
  const out: string[] = [];
  if (heaviest !== null) {
    out.push(
      `Heaviest process: ${heaviest.type} (+${heaviest.deltaPct.toFixed(2)} % of the machine with the overlays open).`,
    );
  }
  out.push("Lower the update rates: Leaderboard to 5 Hz and Fuel to 5 Hz.");
  out.push("Hide windows you do not need while racing, or turn off overlays you rarely use.");
  return out;
}

export function buildResult(args: {
  startedAt: Date;
  finishedAt: Date;
  cores: number;
  source: string;
  phaseA: PerfPhaseSummary;
  phaseB: PerfPhaseSummary;
  targetPct?: number;
}): PerfCheckResult {
  const targetPct = args.targetPct ?? CPU_BUDGET_PCT;
  const byType = compareTypes(args.phaseA, args.phaseB);
  const heaviest = byType.find((t) => t.deltaPct > 0) ?? null;
  const budgetPct = round(args.phaseB.meanPct - args.phaseA.meanPct);
  return {
    version: 1,
    startedAt: args.startedAt.toISOString(),
    finishedAt: args.finishedAt.toISOString(),
    cores: args.cores,
    source: args.source,
    phaseA: args.phaseA,
    phaseB: args.phaseB,
    budgetPct,
    p95DiffPct: round(args.phaseB.p95Pct - args.phaseA.p95Pct),
    targetPct,
    pass: budgetPct <= targetPct,
    byType,
    heaviest,
    suggestions: suggestionsFor(budgetPct, heaviest, targetPct),
  };
}

export interface PhasePlan {
  id: PerfPhaseId;
  label: string;
  /** Overlay ids open during the phase. */
  enabledIds: string[];
  seconds: number;
}

export function planPhases(
  phaseSeconds = PHASE_SECONDS,
  overlayIds: readonly string[] = PERF_OVERLAY_IDS,
): PhasePlan[] {
  return [
    { id: "A", label: "All overlay windows closed", enabledIds: [], seconds: phaseSeconds },
    { id: "B", label: "Five M2 overlays open", enabledIds: [...overlayIds], seconds: phaseSeconds },
  ];
}

/** The in-memory enabled map for a phase: every known overlay is listed, true only for `enabled`. */
export function overrideFor(
  allIds: readonly string[],
  enabled: readonly string[],
): Record<string, boolean> {
  const on = new Set(enabled);
  return Object.fromEntries(allIds.map((id) => [id, on.has(id)]));
}

export interface PerfCheckDeps {
  cores: number;
  source: string;
  allOverlayIds: readonly string[];
  getMetrics(): readonly RawProcessMetric[];
  /** Sets the in-memory enabled override (null restores the stored settings). Never persists. */
  setOverride(override: Record<string, boolean> | null): void;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): Date;
  onProgress(progress: PerfProgress): void;
  phaseSeconds?: number;
  settleSeconds?: number;
}

/** Runs both phases. The override is always cleared again, also on cancel and on error. */
export async function runPerfCheck(
  deps: PerfCheckDeps,
  signal: AbortSignal,
): Promise<PerfCheckOutcome> {
  const phases = planPhases(deps.phaseSeconds);
  const settle = deps.settleSeconds ?? SETTLE_SECONDS;
  const overallTotalS = phases.reduce((sum, p) => sum + p.seconds + settle, 0);
  const startedAt = deps.now();
  const summaries: PerfPhaseSummary[] = [];
  let done = 0;
  try {
    for (const phase of phases) {
      deps.setOverride(overrideFor(deps.allOverlayIds, phase.enabledIds));
      const progress = (kind: PerfProgress["phase"], elapsedS: number, totalS: number): void =>
        deps.onProgress({
          phase: kind,
          phaseId: phase.id,
          label: phase.label,
          elapsedS,
          totalS,
          overallDoneS: done,
          overallTotalS,
        });
      // Let windows open or close, and let the first reading (which covers an earlier period) pass.
      for (let s = 0; s < settle; s++) {
        progress("settle", s, settle);
        await deps.sleep(SAMPLE_INTERVAL_MS, signal);
        done++;
      }
      deps.getMetrics();
      const samples: CpuSample[] = [];
      for (let s = 0; s < phase.seconds; s++) {
        progress(phase.id, s, phase.seconds);
        await deps.sleep(SAMPLE_INTERVAL_MS, signal);
        samples.push(sampleFromMetrics(deps.getMetrics(), deps.cores));
        done++;
      }
      summaries.push(
        summarizePhase(phase.id, phase.label, phase.enabledIds, samples, phase.seconds),
      );
    }
  } catch (error) {
    if (signal.aborted) return { status: "cancelled" };
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    deps.onProgress({
      phase: "restore",
      phaseId: "B",
      label: "Restoring overlays",
      elapsedS: 0,
      totalS: 0,
      overallDoneS: done,
      overallTotalS,
    });
    deps.setOverride(null);
  }
  const [phaseA, phaseB] = summaries;
  if (!phaseA || !phaseB) return { status: "error", error: "Missing phase results" };
  return {
    status: "done",
    result: buildResult({
      startedAt,
      finishedAt: deps.now(),
      cores: deps.cores,
      source: deps.source,
      phaseA,
      phaseB,
    }),
  };
}

/** File name for a saved result: ISO time with characters Windows does not allow replaced. */
export function resultFileName(at: Date): string {
  return `${at.toISOString().replace(/[:.]/g, "-")}.json`;
}

/** Abortable delay for the real clock. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
