import { describe, expect, it } from "vitest";
import { cornersFor, parseCornerList, type CornerList } from "./index";

const KEYS = [
  "iracing_virginia-international-raceway_full-course",
  "lmu_circuit-de-la-sarthe",
] as const;

describe("corner lists", () => {
  it.each(KEYS)("%s is a derived list with evidence and numbered corners", (key) => {
    const list = cornersFor(key) as CornerList;
    expect(list.trackKey).toBe(key);
    expect(list.status).toBe("derived");
    expect(list.evidence.length).toBeGreaterThan(200);
    expect(list.corners.length).toBeGreaterThanOrEqual(8);
    list.corners.forEach((c, i) => expect(c.number).toBe(i + 1));
  });

  it.each(KEYS)("%s has ordered corners that do not overlap", (key) => {
    const corners = (cornersFor(key) as CornerList).corners;
    for (const c of corners) expect(c.endPct).toBeGreaterThan(c.startPct);
    for (let i = 1; i < corners.length; i++) {
      expect(corners[i]?.startPct).toBeGreaterThanOrEqual(corners[i - 1]?.endPct ?? 1);
    }
  });

  it("names only the corners that are public fact", () => {
    const named = (cornersFor(KEYS[1]) as CornerList).corners.filter((c) => c.name !== undefined);
    expect(named.map((c) => c.name)).toEqual(["Tertre Rouge", "Mulsanne Corner"]);
    expect((cornersFor(KEYS[0]) as CornerList).corners.some((c) => c.name !== undefined)).toBe(
      false,
    );
  });

  it("finds a list by track key and says when there is none", () => {
    expect(cornersFor("iracing_somewhere-else")).toBeNull();
    expect(cornersFor(null)).toBeNull();
  });

  it("refuses a list that breaks the schema", () => {
    const good = cornersFor(KEYS[0]) as CornerList;
    const bad = (over: object): unknown => ({ ...good, ...over });
    expect(() => parseCornerList(bad({ status: "official" }))).toThrow(/derived/);
    expect(() => parseCornerList(bad({ evidence: "" }))).toThrow(/evidence/);
    expect(() =>
      parseCornerList(bad({ corners: [{ number: 2, startPct: 0, endPct: 1 }] })),
    ).toThrow(/number/);
    expect(() =>
      parseCornerList(bad({ corners: [{ number: 1, startPct: -1, endPct: 1 }] })),
    ).toThrow(/startPct/);
    expect(() => parseCornerList(null)).toThrow();
  });
});
