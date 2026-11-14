import { describe, expect, it } from "vitest";
import { Deriver } from "./derive";
import { MockSource } from "./mock";

describe("Deriver incident log", () => {
  it("logs the demo's 2x and the field's off-tracks, newest first", () => {
    const mock = new MockSource();
    const deriver = new Deriver();
    let out = deriver.next(mock.step(0.1));
    for (let i = 0; i < 2500; i++) out = deriver.next(mock.step(0.1));
    const events = out.incidentLog?.events ?? [];
    const own = events.filter((e) => e.own);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ points: 2, kind: "loss-of-control", lap: 3, sector: 2 });
    const field = events.filter((e) => !e.own);
    expect(field.length).toBeGreaterThanOrEqual(2);
    expect(field.every((e) => e.kind === "off-track" && e.points === null)).toBe(true);
    const times = events.map((e) => e.timeS);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
