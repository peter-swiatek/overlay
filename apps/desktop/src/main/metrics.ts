import type { ProcessMetric } from "../shared/types";

/** The subset of Electron.ProcessMetric we use (workingSetSize is in kilobytes). */
export interface RawProcessMetric {
  type: string;
  /** Set for utility processes (Electron `serviceName`). */
  serviceName?: string | undefined;
  cpu: { percentCPUUsage: number };
  memory: { workingSetSize: number };
}

/** Capture and telemetry are both type "Utility", so utility processes are keyed by serviceName. */
export function metricKey(m: RawProcessMetric): string {
  return m.type === "Utility" && m.serviceName ? `Utility: ${m.serviceName}` : m.type;
}

/** Sums CPU % and working-set memory per process type. */
export function summarizeMetrics(raw: readonly RawProcessMetric[]): ProcessMetric[] {
  const byType = new Map<string, ProcessMetric>();
  for (const m of raw) {
    const key = metricKey(m);
    const entry = byType.get(key) ?? { type: key, count: 0, cpuPercent: 0, memoryMb: 0 };
    entry.count += 1;
    entry.cpuPercent += m.cpu.percentCPUUsage;
    entry.memoryMb += m.memory.workingSetSize / 1024;
    byType.set(key, entry);
  }
  return [...byType.values()]
    .map((e) => ({
      ...e,
      cpuPercent: Math.round(e.cpuPercent * 10) / 10,
      memoryMb: Math.round(e.memoryMb * 10) / 10,
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}
