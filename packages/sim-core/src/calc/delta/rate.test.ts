import { describe, expect, it } from "vitest";
import { DeltaRate } from "./rate";

describe("DeltaRate", () => {
  it("is null on the first sample", () => {
    expect(new DeltaRate().next(0.1, 0.2)).toBeNull();
  });

  it("is positive for a rising delta and negative for a falling one", () => {
    const up = new DeltaRate();
    let r: number | null = null;
    for (let i = 0; i < 20; i++) r = up.next(0.1, i * 0.01);
    expect(r!).toBeGreaterThan(0.05);
    expect(r!).toBeLessThan(0.15);
    const down = new DeltaRate();
    for (let i = 0; i < 20; i++) r = down.next(0.1, -i * 0.01);
    expect(r!).toBeLessThan(-0.05);
  });

  it("clamps to -1..1", () => {
    const rate = new DeltaRate();
    rate.next(0.1, 0);
    expect(rate.next(0.1, 5)).toBe(1);
    const neg = new DeltaRate();
    neg.next(0.1, 0);
    expect(neg.next(0.1, -5)).toBe(-1);
  });

  it("smooths with a 0.5 s time constant", () => {
    const rate = new DeltaRate();
    rate.next(0.1, 0);
    rate.next(0.1, 0); // rate 0
    const r = rate.next(0.1, 0.05)!; // raw 0.5
    expect(r).toBeCloseTo(0.5 * (1 - Math.exp(-0.2)), 6);
  });

  it("resets on a null delta, a long gap and reset()", () => {
    const rate = new DeltaRate();
    rate.next(0.1, 0);
    expect(rate.next(0.1, 0.1)).not.toBeNull();
    expect(rate.next(0.1, null)).toBeNull();
    expect(rate.next(0.1, 0.1)).toBeNull();
    expect(rate.next(0.1, 0.2)).not.toBeNull();
    expect(rate.next(1.5, 0.3)).toBeNull();
    expect(rate.next(0.1, 0.35)).not.toBeNull();
    rate.reset();
    expect(rate.next(0.1, 0.4)).toBeNull();
  });
});
