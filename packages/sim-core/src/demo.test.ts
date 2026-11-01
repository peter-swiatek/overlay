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
});
