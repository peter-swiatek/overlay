import { describe, expect, it } from "vitest";
import { createDemoFeed } from "./demo";

describe("createDemoFeed", () => {
  it("is deterministic", () => {
    const a = createDemoFeed();
    const b = createDemoFeed();
    for (let i = 0; i < 20; i++) expect(a.next(0.1)).toEqual(b.next(0.1));
  });

  it("counts seq from 1 and reports a live mock frame", () => {
    const feed = createDemoFeed({ warmUpLaps: 1 });
    expect(feed.next(0.1).seq).toBe(1);
    const f = feed.next(0.1);
    expect(f.seq).toBe(2);
    expect(f.source).toBe("mock");
    expect(f.status).toBe("live");
  });

  it("has 20 cars in 2 classes, gaps and fuel after warm-up", () => {
    const f = createDemoFeed().next(0.1);
    expect(f.state.cars).toHaveLength(20);
    expect(new Set(f.state.cars.map((c) => c.classId)).size).toBe(2);
    expect(f.derived.standings).not.toBeNull();
    expect(f.derived.gaps.length).toBeGreaterThan(0);
    expect(f.derived.gaps.some((g) => g.gapS !== null)).toBe(true);
    expect(f.derived.fuel).not.toBeNull();
    expect(f.derived.fuel?.fuelAvgLap).not.toBeNull();
  });

  it("uses invented driver names", () => {
    const names = createDemoFeed()
      .next(0.1)
      .state.cars.map((c) => c.driverName);
    expect(new Set(names).size).toBe(20);
    for (const n of names) expect(n).not.toMatch(/mock/i);
  });

  it("costs under 1 ms per step on average", () => {
    const feed = createDemoFeed();
    for (let i = 0; i < 50; i++) feed.next(0.1);
    const n = 500;
    const start = performance.now();
    for (let i = 0; i < n; i++) feed.next(0.1);
    expect((performance.now() - start) / n).toBeLessThan(1);
  });

  it("fills the design-system fields in a warmed-up frame, except documented nulls", () => {
    const { state, derived } = createDemoFeed().next(0.1);
    const p = state.player;
    // The player has a start position, so the Telemetry Strip can show places gained in previews.
    expect(derived.standings?.entries.find((e) => e.carIdx === 0)?.startPosition).not.toBeNull();
    expect(p.lap?.currentLapS).not.toBeNull();
    expect(p.lap?.lastLapS).not.toBeNull();
    expect(p.lap?.bestLapS).not.toBeNull();
    expect(p.lap?.delta?.best).not.toBeNull();
    expect(p.lap?.delta?.sessionBest).not.toBeNull();
    expect(p.lap?.delta?.sessionLast).not.toBeNull();
    expect(p.absActive).not.toBeNull();
    expect(p.trackSurface).not.toBeNull();
    expect(p.isOnTrack).not.toBeNull();
    expect(p.shiftLights).not.toBeNull();
    expect(p.redlineRpm).not.toBeNull();
    expect(p.steerMaxRad).not.toBeNull();
    expect(p.yawRad).not.toBeNull();
    expect(p.pitLimiter).not.toBeNull();
    expect(p.pitStallLapDistPct).not.toBeNull();
    expect(p.incidentCount).not.toBeNull();
    expect(state.conditions.precipitation).not.toBeNull();
    expect(state.session.typeName).not.toBeNull();
    expect(state.session.trackUsage).not.toBeNull();
    expect(state.conditions.declaredWet).not.toBeNull();
    expect(state.conditions.humidity).not.toBeNull();
    expect(state.conditions.windSpeedMps).not.toBeNull();
    for (const car of state.cars) {
      expect(car.flags).not.toBeNull();
      expect(car.trackSurface).not.toBeNull();
      // Documented nulls: push-to-pass exists on the Hypercar class only.
      if (car.classId === "2") {
        expect(car.p2pCount).not.toBeNull();
        expect(car.p2pActive).not.toBeNull();
      } else {
        expect(car.p2pCount).toBeNull();
        expect(car.p2pActive).toBeNull();
      }
    }
  });
});
