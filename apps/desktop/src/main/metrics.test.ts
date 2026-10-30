import { describe, expect, it } from "vitest";
import { summarizeMetrics } from "./metrics";

const m = (type: string, cpu: number, kb: number) => ({
  type,
  cpu: { percentCPUUsage: cpu },
  memory: { workingSetSize: kb },
});

describe("summarizeMetrics", () => {
  it("groups by process type and converts KB to MB", () => {
    expect(
      summarizeMetrics([m("Tab", 1.25, 10240), m("Browser", 2, 20480), m("Tab", 0.5, 5120)]),
    ).toEqual([
      { type: "Browser", count: 1, cpuPercent: 2, memoryMb: 20 },
      { type: "Tab", count: 2, cpuPercent: 1.8, memoryMb: 15 },
    ]);
  });
});
