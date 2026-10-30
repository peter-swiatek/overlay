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

  it("lists utility processes by serviceName", () => {
    const util = (serviceName: string | undefined, cpu: number) => ({
      ...m("Utility", cpu, 1024),
      serviceName,
    });
    expect(
      summarizeMetrics([
        util("overlay-capture", 3),
        util("overlay-telemetry", 1.5),
        util("overlay-telemetry", 0.5),
        util(undefined, 0),
      ]).map((e) => [e.type, e.count, e.cpuPercent]),
    ).toEqual([
      ["Utility", 1, 0],
      ["Utility: overlay-capture", 1, 3],
      ["Utility: overlay-telemetry", 2, 2],
    ]);
  });
});
