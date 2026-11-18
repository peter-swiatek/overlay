import { describe, expect, it } from "vitest";
import type { IncidentAhead } from "../calc/incident-ahead";
import { Deriver } from "./derive";
import { MockSource } from "./mock";

describe("Deriver incident ahead", () => {
  it("shows the demo's car crawling, then stopped, ahead of the player, and clears once passed", () => {
    const mock = new MockSource();
    const d = new Deriver();
    const seen: { t: number; out: IncidentAhead | null }[] = [];
    for (let i = 0; i < 600; i++) {
      const state = mock.step(0.1);
      seen.push({ t: state.tickTimeS!, out: d.next(state).incidentAhead });
    }
    const at = (t: number) => seen.find((s) => Math.abs(s.t - t) < 0.05)!.out;
    expect(seen.filter((s) => s.t < 40).every((s) => s.out === null)).toBe(true);
    expect(at(44)).toMatchObject({ carIdx: 15, carNumber: "16", kind: "slow", stopped: false });
    expect(at(48)).toMatchObject({ carIdx: 15, kind: "stopped", stopped: true });
    expect(at(49.5)!.distanceM).toBeLessThan(100);
    expect(at(52)).toBeNull();
    const distances = seen.filter((s) => s.out !== null).map((s) => s.out!.distanceM);
    expect([...distances].sort((a, b) => b - a)).toEqual(distances);
  });

  it("resets with the Deriver", () => {
    const mock = new MockSource();
    const d = new Deriver();
    for (let i = 0; i < 480; i++) d.next(mock.step(0.1));
    d.reset();
    expect(d.next(mock.step(0.1)).incidentAhead).toBeNull();
  });
});
