import { describe, expect, it } from "vitest";
import type { PerfProgress } from "../shared/perf-types";
import type { RawProcessMetric } from "./metrics";
import {
  abortableSleep,
  buildResult,
  mean,
  overrideFor,
  percentile,
  perCoreToMachinePct,
  planPhases,
  resultFileName,
  runPerfCheck,
  sampleFromMetrics,
  suggestionsFor,
  summarizePhase,
  type PerfCheckDeps,
} from "./perf-check";

function metric(type: string, cpu: number, name?: string): RawProcessMetric {
  return { type, name, cpu: { percentCPUUsage: cpu }, memory: { workingSetSize: 1024 } };
}

describe("stats", () => {
  it("mean and nearest-rank percentile", () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(v, 0.95)).toBe(19);
    expect(percentile(v, 1)).toBe(20);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
  });
});

describe("per-core normalisation", () => {
  it("divides by the core count", () => {
    expect(perCoreToMachinePct(80, 8)).toBe(10);
    expect(perCoreToMachinePct(50, 0)).toBe(50);
  });

  it("sums per process type and in total", () => {
    const s = sampleFromMetrics(
      [
        metric("Browser", 8),
        metric("Tab", 16),
        metric("Tab", 8),
        metric("Utility", 4, "overlay-telemetry"),
      ],
      4,
    );
    expect(s.total).toBe(9);
    expect(s.byType).toEqual({ Browser: 2, Tab: 6, "Utility: overlay-telemetry": 1 });
  });
});

describe("phase planning", () => {
  it("has a closed phase then the five overlays", () => {
    const [a, b] = planPhases();
    expect(a).toMatchObject({ id: "A", enabledIds: [], seconds: 60 });
    expect(b?.enabledIds).toEqual(["leaderboard", "relative", "spotter", "pit-speed", "fuel"]);
    expect(b?.seconds).toBe(60);
  });

  it("builds an override listing every overlay", () => {
    expect(overrideFor(["a", "b", "c"], ["b"])).toEqual({ a: false, b: true, c: false });
  });
});

describe("result and suggestions", () => {
  const phase = (id: "A" | "B", totals: number[], tab: number[]) =>
    summarizePhase(
      id,
      id,
      [],
      totals.map((total, i) => ({
        total,
        byType: { Tab: tab[i] ?? 0, Browser: total - (tab[i] ?? 0) },
      })),
      totals.length,
    );
  const at = new Date("2026-01-02T03:04:05.678Z");

  it("budget is the difference of means, heaviest is the largest increase", () => {
    const r = buildResult({
      startedAt: at,
      finishedAt: at,
      cores: 8,
      source: "mock",
      phaseA: phase("A", [1, 1, 1, 1], [0.2, 0.2, 0.2, 0.2]),
      phaseB: phase("B", [5, 5, 5, 6], [4, 4, 4, 5]),
    });
    expect(r.budgetPct).toBe(4.25);
    expect(r.pass).toBe(false);
    expect(r.heaviest?.type).toBe("Tab");
    expect(r.suggestions.join(" ")).toContain("Tab");
    expect(r.suggestions.join(" ")).toContain("Leaderboard to 5 Hz");
    expect(r.suggestions.join(" ")).toContain("Fuel to 5 Hz");
  });

  it("passes at or under the target with no suggestions", () => {
    const r = buildResult({
      startedAt: at,
      finishedAt: at,
      cores: 8,
      source: "mock",
      phaseA: phase("A", [1, 1], [0, 0]),
      phaseB: phase("B", [3, 4], [2, 3]),
    });
    expect(r.budgetPct).toBe(2.5);
    expect(r.pass).toBe(true);
    expect(r.suggestions).toEqual([]);
    expect(suggestionsFor(3, null)).toEqual([]);
    expect(suggestionsFor(3.1, null)).toHaveLength(2);
  });

  it("names files safely", () => {
    expect(resultFileName(at)).toBe("2026-01-02T03-04-05-678Z.json");
  });
});

describe("runPerfCheck", () => {
  function setup(overrides: Partial<PerfCheckDeps> = {}) {
    const overrideCalls: (Record<string, boolean> | null)[] = [];
    const progress: PerfProgress[] = [];
    let open = false;
    const deps: PerfCheckDeps = {
      cores: 4,
      source: "mock",
      allOverlayIds: ["leaderboard", "relative", "spotter", "pit-speed", "fuel", "inputs"],
      getMetrics: () => [metric("Browser", open ? 40 : 4)],
      setOverride: (o) => {
        overrideCalls.push(o);
        open = o?.["fuel"] === true;
      },
      sleep: async () => undefined,
      now: () => new Date("2026-01-01T00:00:00Z"),
      onProgress: (p) => progress.push(p),
      phaseSeconds: 5,
      settleSeconds: 1,
      ...overrides,
    };
    return { deps, overrideCalls, progress };
  }

  it("measures both phases and restores", async () => {
    const { deps, overrideCalls, progress } = setup();
    const out = await runPerfCheck(deps, new AbortController().signal);
    expect(out.status).toBe("done");
    if (out.status !== "done") return;
    expect(out.result.phaseA.meanPct).toBe(1);
    expect(out.result.phaseB.meanPct).toBe(10);
    expect(out.result.phaseA.samples).toBe(5);
    expect(out.result.budgetPct).toBe(9);
    expect(overrideCalls[0]).toMatchObject({ fuel: false, inputs: false });
    expect(overrideCalls[1]).toMatchObject({ fuel: true, inputs: false });
    expect(overrideCalls.at(-1)).toBeNull();
    expect(progress.at(-1)?.phase).toBe("restore");
  });

  it("restores on cancel", async () => {
    const ctl = new AbortController();
    let sleeps = 0;
    const { deps, overrideCalls } = setup({
      sleep: async () => {
        if (++sleeps === 4) {
          ctl.abort();
          throw new Error("cancelled");
        }
      },
    });
    const out = await runPerfCheck(deps, ctl.signal);
    expect(out).toEqual({ status: "cancelled" });
    expect(overrideCalls.at(-1)).toBeNull();
  });

  it("restores on error", async () => {
    const { deps, overrideCalls } = setup({
      getMetrics: () => {
        throw new Error("boom");
      },
    });
    const out = await runPerfCheck(deps, new AbortController().signal);
    expect(out).toEqual({ status: "error", error: "boom" });
    expect(overrideCalls.at(-1)).toBeNull();
  });
});

describe("abortableSleep", () => {
  it("rejects when aborted", async () => {
    const ctl = new AbortController();
    const p = abortableSleep(10_000, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toThrow("cancelled");
    await expect(abortableSleep(1, ctl.signal)).rejects.toThrow("cancelled");
  });

  it("resolves after the delay", async () => {
    await expect(abortableSleep(1, new AbortController().signal)).resolves.toBeUndefined();
  });
});
