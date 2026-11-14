import { describe, expect, it } from "vitest";
import { projectIRatingChanges } from "./irating";

const field = (ratings: number[]) =>
  ratings.map((iRating, i) => ({ carIdx: i + 1, iRating, position: i + 1 }));

describe("projectIRatingChanges", () => {
  it("gives equal ratings a winner above zero and a last place below, of similar size", () => {
    const out = projectIRatingChanges(field(Array<number>(10).fill(2000)));
    expect(out.get(1) as number).toBeGreaterThan(0);
    expect(out.get(10) as number).toBeLessThan(0);
    expect(Math.abs((out.get(1) as number) + (out.get(10) as number))).toBeLessThanOrEqual(2);
  });

  it("sums to roughly zero over the field", () => {
    const out = projectIRatingChanges(field([3100, 2700, 2400, 2000, 1800, 1500, 1200, 900]));
    const sum = [...out.values()].reduce((a, b) => a + b, 0);
    expect(Math.abs(sum)).toBeLessThanOrEqual(8);
  });

  it("rewards beating a higher-rated car more", () => {
    const out = projectIRatingChanges([
      { carIdx: 1, iRating: 1000, position: 1 },
      { carIdx: 2, iRating: 3000, position: 2 },
    ]);
    expect(out.get(1) as number).toBeGreaterThan(60);
    expect(out.get(2) as number).toBeLessThan(0);
  });

  it("ignores unrated cars and needs two rated cars", () => {
    expect(projectIRatingChanges([{ carIdx: 1, iRating: 2000, position: 1 }]).size).toBe(0);
    const out = projectIRatingChanges([
      { carIdx: 1, iRating: 2000, position: 1 },
      { carIdx: 2, iRating: 0, position: 2 },
      { carIdx: 3, iRating: 2000, position: 3 },
    ]);
    expect(out.has(2)).toBe(false);
    expect(out.size).toBe(2);
  });

  it("is deterministic", () => {
    const f = field([2500, 2100, 1900, 1700]);
    expect([...projectIRatingChanges(f)]).toEqual([...projectIRatingChanges(f)]);
  });
});
