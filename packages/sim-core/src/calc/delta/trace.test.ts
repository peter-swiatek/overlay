import { describe, expect, it } from "vitest";
import { computedDelta, LapTraceRecorder, traceSpeedAt, traceTimeAt } from "./trace";
import { LAP_TRACE_BINS, type LapTrace } from "./types";

function drive(
  rec: LapTraceRecorder,
  lapS: number,
  tickS: number,
  speed: (frac: number) => number | null = () => 50,
  untilFrac = 1,
): void {
  rec.start();
  for (let t = 0; t <= lapS + 1e-9; t += tickS) {
    const frac = t / lapS;
    if (frac > untilFrac) break;
    rec.sample(Math.min(frac, 0.99999), t, speed(frac));
  }
}

function linearTrace(lapS: number, speed = 50): LapTrace {
  return {
    timeS: Array.from({ length: LAP_TRACE_BINS }, (_, k) => (k / LAP_TRACE_BINS) * lapS),
    speedMps: new Array<number>(LAP_TRACE_BINS).fill(speed),
  };
}

describe("LapTraceRecorder", () => {
  it("records a constant-speed lap", () => {
    const rec = new LapTraceRecorder();
    drive(rec, 100, 0.1);
    const trace = rec.finish();
    expect(trace).not.toBeNull();
    expect(trace!.timeS).toHaveLength(LAP_TRACE_BINS);
    expect(trace!.timeS[0]).toBe(0);
    expect(Math.abs(trace!.timeS[200]! - 50)).toBeLessThan(0.001);
    expect(trace!.speedMps[123]).toBeCloseTo(50, 6);
  });

  it("fills every bin with coarse ticks", () => {
    const rec = new LapTraceRecorder();
    drive(rec, 100, 0.25);
    const trace = rec.finish()!;
    for (let k = 1; k < 399; k++) expect(trace.timeS[k]).toBeGreaterThan(trace.timeS[k - 1]!);
    expect(Math.abs(trace.timeS[300]! - 75)).toBeLessThan(0.001);
  });

  it("interpolates speed between ticks", () => {
    const rec = new LapTraceRecorder();
    drive(rec, 100, 0.1, (f) => 40 + 20 * f);
    const trace = rec.finish()!;
    expect(trace.speedMps[200]).toBeCloseTo(50, 1);
  });

  it("breaks on a jump back", () => {
    const rec = new LapTraceRecorder();
    for (let f = 0.01; f <= 0.1; f += 0.01) rec.sample(f, f * 100, 50);
    expect(rec.sample(0.05, 11, 50)).toBe(false);
    expect(rec.broken).toBe(true);
    expect(rec.sample(0.2, 12, 50)).toBe(false);
    expect(rec.finish()).toBeNull();
    rec.start();
    expect(rec.broken).toBe(false);
  });

  it("tolerates a tiny step back", () => {
    const rec = new LapTraceRecorder();
    for (let f = 0.01; f <= 0.1; f += 0.01) rec.sample(f, f * 100, 50);
    expect(rec.sample(0.095, 10.1, 50)).toBe(true);
  });

  it("breaks on a forward jump over 0.05", () => {
    const rec = new LapTraceRecorder();
    expect(rec.sample(0.04, 4, 50)).toBe(true);
    expect(rec.sample(0.2, 11, 50)).toBe(false);
  });

  it("breaks on non-finite values", () => {
    const rec = new LapTraceRecorder();
    expect(rec.sample(Number.NaN, 1, 50)).toBe(false);
    rec.start();
    expect(rec.sample(0.01, Number.NaN, 50)).toBe(false);
  });

  it("finishes null below 98 percent of the bins", () => {
    const rec = new LapTraceRecorder();
    drive(rec, 100, 0.1, () => 50, 0.9);
    expect(rec.finish()).toBeNull();
  });

  it("copies neighbouring speeds when speeds are missing", () => {
    const rec = new LapTraceRecorder();
    drive(rec, 100, 0.1, (f) => (f < 0.5 ? null : 30));
    const trace = rec.finish()!;
    expect(trace.speedMps[10]).toBe(30);
    expect(trace.speedMps[399]).toBe(30);
  });

  it("returns null when no speed was ever given", () => {
    const rec = new LapTraceRecorder();
    drive(rec, 100, 0.1, () => null);
    expect(rec.finish()).toBeNull();
  });
});

describe("trace lookups", () => {
  const trace = linearTrace(100);

  it("reads times at bins, between bins and in the last bin", () => {
    expect(traceTimeAt(trace, 100, 0)).toBe(0);
    expect(traceTimeAt(trace, 100, 0.5)).toBeCloseTo(50, 9);
    expect(traceTimeAt(trace, 100, 0.5 + 0.5 / 400)).toBeCloseTo(50.125, 6);
    expect(traceTimeAt(trace, 100, 0.9999)).toBeCloseTo(99.99, 2);
    expect(traceTimeAt(trace, 100, 1)).toBeCloseTo(100, 9);
  });

  it("closes the last bin at the lap time", () => {
    expect(traceTimeAt(trace, 101, 1)).toBeCloseTo(101, 9);
  });

  it("reads speeds with wrap to bin 0", () => {
    const t: LapTrace = { ...trace, speedMps: trace.speedMps.map((_, k) => (k === 399 ? 60 : 40)) };
    expect(traceSpeedAt(t, 0.2)).toBe(40);
    expect(traceSpeedAt(t, 399.5 / 400)).toBeCloseTo(50, 6);
    expect(traceSpeedAt(t, 399 / 400)).toBeCloseTo(60, 6);
  });
});

describe("computedDelta", () => {
  it("is +0.5 s at half distance for a 101 s lap against a 100 s reference", () => {
    const ref = linearTrace(100);
    expect(computedDelta(ref, 100, 0.5, 50.5)).toBeCloseTo(0.5, 9);
  });
});
