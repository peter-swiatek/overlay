import { describe, expect, it } from "vitest";
import { EMPTY_SIM_CONTEXT, type LayoutMatch, type SimContext } from "../shared/layout-types";
import { ContextChangeTracker, matchScore, pickLayout, sameCarName } from "./layout-match";

const match = (m: Partial<LayoutMatch> = {}): LayoutMatch => ({
  sims: [],
  cars: [],
  sessions: [],
  ...m,
});
const ctx = (c: Partial<SimContext> = {}): SimContext => ({
  sim: "iracing",
  carName: "Porsche 911 GT3 R (992)",
  sessionType: "race",
  ...c,
});

describe("matchScore", () => {
  it("scores 0 for a layout without tags", () => {
    expect(matchScore(match(), ctx())).toBe(0);
    expect(matchScore(match(), EMPTY_SIM_CONTEXT)).toBe(0);
  });

  it("adds car 4, session 2 and sim 1 for each set tag that matches", () => {
    expect(matchScore(match({ sims: ["iracing"] }), ctx())).toBe(1);
    expect(matchScore(match({ sessions: ["race", "qualifying"] }), ctx())).toBe(2);
    expect(matchScore(match({ cars: ["Porsche 911 GT3 R (992)"] }), ctx())).toBe(4);
    expect(
      matchScore(
        match({ sims: ["iracing"], sessions: ["race"], cars: ["Porsche 911 GT3 R (992)"] }),
        ctx(),
      ),
    ).toBe(7);
  });

  it("excludes a layout when any set tag does not match", () => {
    expect(matchScore(match({ sims: ["lmu"] }), ctx())).toBeNull();
    expect(matchScore(match({ sessions: ["practice"] }), ctx())).toBeNull();
    expect(matchScore(match({ cars: ["Ferrari 296 GT3"] }), ctx())).toBeNull();
    expect(matchScore(match({ sims: ["iracing"], cars: ["Ferrari 296 GT3"] }), ctx())).toBeNull();
  });

  it("never matches a set tag with an unknown value", () => {
    expect(matchScore(match({ cars: ["X"] }), ctx({ carName: null }))).toBeNull();
    expect(matchScore(match({ sessions: ["race"] }), ctx({ sessionType: null }))).toBeNull();
    expect(matchScore(match({ sims: ["iracing"] }), ctx({ sim: null }))).toBeNull();
  });

  it("compares car names without case or surrounding spaces", () => {
    expect(sameCarName(" porsche 911 gt3 r (992) ", "Porsche 911 GT3 R (992)")).toBe(true);
    expect(matchScore(match({ cars: ["porsche 911 GT3 R (992)"] }), ctx())).toBe(4);
  });

  it("matches the Testing / other session type like any other", () => {
    expect(matchScore(match({ sessions: ["other"] }), ctx({ sessionType: "other" }))).toBe(2);
  });
});

describe("pickLayout", () => {
  const layouts = [
    { id: "default", match: match() },
    { id: "race", match: match({ sessions: ["race"] }) },
    { id: "iracing", match: match({ sims: ["iracing"] }) },
    { id: "porsche", match: match({ cars: ["Porsche 911 GT3 R (992)"] }) },
    { id: "porsche-race", match: match({ cars: ["Porsche 911 GT3 R (992)"], sessions: ["race"] }) },
    { id: "untagged", match: match() },
  ];

  it("picks the most specific matching layout", () => {
    expect(pickLayout(layouts, ctx(), "default")).toBe("porsche-race");
    expect(pickLayout(layouts, ctx({ sessionType: "practice" }), "default")).toBe("porsche");
    expect(pickLayout(layouts, ctx({ carName: "Other", sessionType: "practice" }), "default")).toBe(
      "iracing",
    );
    expect(pickLayout(layouts, ctx({ carName: "Other" }), "default")).toBe("race");
  });

  it("prefers a car match over session and sim together", () => {
    const list = [
      { id: "sim-session", match: match({ sims: ["iracing"], sessions: ["race"] }) },
      { id: "car", match: match({ cars: ["Porsche 911 GT3 R (992)"] }) },
    ];
    expect(pickLayout(list, ctx(), "default")).toBe("car");
  });

  it("breaks ties by list order", () => {
    const list = [
      { id: "a", match: match({ sessions: ["race"] }) },
      { id: "b", match: match({ sessions: ["race", "qualifying"] }) },
    ];
    expect(pickLayout(list, ctx(), "default")).toBe("a");
    expect(pickLayout([...list].reverse(), ctx(), "default")).toBe("b");
  });

  it("lets an untagged layout win over Default only through list order, never Default itself", () => {
    const list = [
      { id: "default", match: match() },
      { id: "untagged", match: match() },
    ];
    expect(pickLayout(list, ctx(), "default")).toBe("untagged");
  });

  it("falls back to Default when nothing matches", () => {
    const list = [
      { id: "default", match: match() },
      { id: "lmu", match: match({ sims: ["lmu"] }) },
    ];
    expect(pickLayout(list, ctx(), "default")).toBe("default");
    expect(pickLayout([], ctx(), "default")).toBe("default");
  });
});

describe("ContextChangeTracker", () => {
  it("acts on the first context and then only on a change", () => {
    const tracker = new ContextChangeTracker();
    expect(tracker.observe(ctx())).toBe(true);
    expect(tracker.observe(ctx())).toBe(false);
    expect(tracker.observe(ctx({ sessionType: "qualifying" }))).toBe(true);
    expect(tracker.observe(ctx({ sessionType: "qualifying", carName: "Other" }))).toBe(true);
    expect(tracker.observe(ctx({ sessionType: "qualifying", carName: "Other", sim: "lmu" }))).toBe(
      true,
    );
  });

  it("ignores the empty context, so coming back to the same session keeps the layout", () => {
    const tracker = new ContextChangeTracker();
    expect(tracker.observe(EMPTY_SIM_CONTEXT)).toBe(false);
    expect(tracker.observe(ctx())).toBe(true);
    expect(tracker.observe(EMPTY_SIM_CONTEXT)).toBe(false);
    expect(tracker.observe(ctx())).toBe(false);
  });

  it("acts again after a reset", () => {
    const tracker = new ContextChangeTracker();
    tracker.observe(ctx());
    tracker.reset();
    expect(tracker.observe(ctx())).toBe(true);
  });
});
