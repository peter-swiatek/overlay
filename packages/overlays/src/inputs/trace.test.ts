import { describe, expect, it } from "vitest";
import { InputTrace, absPath, tracePoints, type InputSample } from "./trace";

const sample = (t: number, over: Partial<InputSample> = {}): InputSample => ({
  t,
  throttle: 0,
  brake: 0,
  clutch: 0,
  steer: 0,
  abs: false,
  ...over,
});

describe("InputTrace", () => {
  it("keeps the window and one sample just outside it", () => {
    const trace = new InputTrace(3);
    for (let t = 0; t <= 10; t += 1) trace.push(sample(t));
    expect(trace.samples.map((s) => s.t)).toEqual([7, 8, 9, 10]);
  });

  it("drops everything when time goes back", () => {
    const trace = new InputTrace(3);
    trace.push(sample(10));
    trace.push(sample(11));
    trace.push(sample(2));
    expect(trace.samples.map((s) => s.t)).toEqual([2]);
  });

  it("clears the trace after a gap longer than the window", () => {
    const trace = new InputTrace(3);
    trace.push(sample(10));
    trace.push(sample(11));
    trace.push(sample(14.5));
    expect(trace.samples.map((s) => s.t)).toEqual([14.5]);
  });

  it("keeps the trace when the gap is within the window", () => {
    const trace = new InputTrace(3);
    trace.push(sample(10));
    trace.push(sample(13));
    expect(trace.samples.map((s) => s.t)).toEqual([10, 13]);
  });

  it("trims in place without replacing the backing array", () => {
    const trace = new InputTrace(3);
    const before = trace.samples;
    for (let t = 0; t <= 20; t += 1) trace.push(sample(t));
    expect(trace.samples).toBe(before);
    expect(trace.samples.map((s) => s.t)).toEqual([17, 18, 19, 20]);
  });

  it("trims when the window shrinks", () => {
    const trace = new InputTrace(10);
    for (let t = 0; t <= 10; t += 1) trace.push(sample(t));
    expect(trace.samples).toHaveLength(11);
    trace.setWindow(2);
    expect(trace.samples.map((s) => s.t)).toEqual([8, 9, 10]);
  });
});

describe("tracePoints", () => {
  it("puts the newest sample at the right edge and the oldest at the left", () => {
    const samples = [sample(7, { throttle: 1 }), sample(10, { throttle: 0 })];
    expect(tracePoints(samples, "throttle", 10, 3, 344, 96)).toBe("0,4 344,92");
  });

  it("maps 0.5 to the middle and keeps 4 px margins", () => {
    const samples = [sample(10, { throttle: 0.5 })];
    expect(tracePoints(samples, "throttle", 10, 3, 344, 96)).toBe("344,48");
  });

  it("maps steering -1..1 to 0..1", () => {
    const samples = [sample(9, { steer: -1 }), sample(9.5, { steer: 0 }), sample(10, { steer: 1 })];
    const pts = tracePoints(samples, "steer", 10, 2, 200, 100);
    expect(pts).toBe("100,96 150,50 200,4");
  });

  it("is empty without samples", () => {
    expect(tracePoints([], "brake", 0, 3, 344, 96)).toBe("");
  });
});

describe("absPath", () => {
  const run = (abs: boolean[]): InputSample[] => abs.map((a, i) => sample(i, { brake: 1, abs: a }));

  it("is empty without ABS samples", () => {
    expect(absPath(run([false, false, false]), 2, 2, 100, 100)).toBe("");
  });

  it("joins one run to its neighbouring points", () => {
    expect(absPath(run([false, true, true, false, false]), 4, 4, 100, 100)).toBe(
      "M 0,4 L 25,4 L 50,4 L 75,4",
    );
  });

  it("makes one segment per run", () => {
    const path = absPath(run([true, false, false, true, false]), 4, 4, 100, 100);
    expect(path).toBe("M 0,4 L 25,4 M 50,4 L 75,4 L 100,4");
  });

  it("handles runs at both ends", () => {
    expect(absPath(run([true, false, true]), 2, 2, 100, 100)).toBe("M 0,4 L 50,4 M 50,4 L 100,4");
    expect(absPath(run([true]), 0, 2, 100, 100)).toBe("M 100,4");
  });
});
