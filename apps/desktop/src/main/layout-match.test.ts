import { describe, expect, it } from "vitest";
import { EMPTY_SIM_CONTEXT, type LayoutMatch, type SimContext } from "../shared/layout-types";
import { ContextChangeTracker, matchScore, pickLayout, sameCarName } from "./layout-match";

const match = (m: Partial<LayoutMatch> = {}): LayoutMatch => ({
  game: null,
  sessions: [],
  carTypes: [],
  cars: [],
  ...m,
});
const ctx = (c: Partial<SimContext> = {}): SimContext => ({
  sim: "iracing",
  carName: "Porsche 911 GT3 R (992)",
  carType: "sports",
  sessionType: "race",
  testData: false,
  ...c,
});
const PORSCHE = "Porsche 911 GT3 R (992)";

describe("matchScore", () => {
  it("scores 0 for a group without conditions", () => {
    expect(matchScore(match(), ctx())).toBe(0);
    expect(matchScore(match(), EMPTY_SIM_CONTEXT)).toBe(0);
  });

  it("adds car 8, car type 4, session 2 and game 1 for each set condition that matches", () => {
    expect(matchScore(match({ game: "iracing" }), ctx())).toBe(1);
    expect(matchScore(match({ sessions: ["race", "qualifying"] }), ctx())).toBe(2);
    expect(matchScore(match({ carTypes: ["sports", "formula"] }), ctx())).toBe(4);
    expect(matchScore(match({ cars: [PORSCHE] }), ctx())).toBe(8);
    expect(
      matchScore(
        match({ game: "iracing", sessions: ["race"], carTypes: ["sports"], cars: [PORSCHE] }),
        ctx(),
      ),
    ).toBe(15);
  });

  it("excludes a group when any set condition does not match", () => {
    expect(matchScore(match({ game: "lmu" }), ctx())).toBeNull();
    expect(matchScore(match({ sessions: ["practice"] }), ctx())).toBeNull();
    expect(matchScore(match({ carTypes: ["formula"] }), ctx())).toBeNull();
    expect(matchScore(match({ cars: ["Ferrari 296 GT3"] }), ctx())).toBeNull();
    expect(matchScore(match({ game: "iracing", cars: ["Ferrari 296 GT3"] }), ctx())).toBeNull();
  });

  it("never matches a set condition with an unknown value", () => {
    expect(matchScore(match({ cars: ["X"] }), ctx({ carName: null }))).toBeNull();
    expect(matchScore(match({ carTypes: ["sports"] }), ctx({ carType: null }))).toBeNull();
    expect(matchScore(match({ sessions: ["race"] }), ctx({ sessionType: null }))).toBeNull();
    expect(matchScore(match({ game: "iracing" }), ctx({ sim: null }))).toBeNull();
  });

  it("compares car names without case or surrounding spaces", () => {
    expect(sameCarName(" porsche 911 gt3 r (992) ", PORSCHE)).toBe(true);
    expect(matchScore(match({ cars: ["porsche 911 GT3 R (992)"] }), ctx())).toBe(8);
  });

  it("matches the Testing session type like any other", () => {
    expect(matchScore(match({ sessions: ["other"] }), ctx({ sessionType: "other" }))).toBe(2);
  });
});

describe("pickLayout", () => {
  const layouts = [
    { id: "default", match: match() },
    { id: "race", match: match({ sessions: ["race"] }) },
    { id: "iracing", match: match({ game: "iracing" }) },
    { id: "lmu", match: match({ game: "lmu" }) },
    { id: "formula", match: match({ game: "iracing", carTypes: ["formula"] }) },
    { id: "porsche", match: match({ cars: [PORSCHE] }) },
    { id: "porsche-race", match: match({ cars: [PORSCHE], sessions: ["race"] }) },
  ];

  it("picks the most specific matching group", () => {
    expect(pickLayout(layouts, ctx(), "default")).toBe("porsche-race");
    expect(pickLayout(layouts, ctx({ sessionType: "practice" }), "default")).toBe("porsche");
    expect(pickLayout(layouts, ctx({ carName: "Dallara F3", carType: "formula" }), "default")).toBe(
      "formula",
    );
    expect(pickLayout(layouts, ctx({ carName: "Other", sessionType: "practice" }), "default")).toBe(
      "iracing",
    );
    expect(pickLayout(layouts, ctx({ carName: "Other" }), "default")).toBe("race");
    expect(
      pickLayout(
        layouts,
        ctx({ sim: "lmu", carName: "Oreca 07", carType: null, sessionType: "practice" }),
        "default",
      ),
    ).toBe("lmu");
  });

  it("prefers a specific car over car type, session and game together", () => {
    const list = [
      {
        id: "type-session-game",
        match: match({ game: "iracing", sessions: ["race"], carTypes: ["sports"] }),
      },
      { id: "car", match: match({ cars: [PORSCHE] }) },
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

  it("never lets the fallback group compete", () => {
    const list = [
      { id: "default", match: match() },
      { id: "untagged", match: match() },
    ];
    expect(pickLayout(list, ctx(), "default")).toBe("untagged");
  });

  it("falls back when nothing matches", () => {
    const list = [
      { id: "default", match: match() },
      { id: "lmu", match: match({ game: "lmu" }) },
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
    expect(tracker.observe(ctx({ sessionType: "qualifying", carType: "oval" }))).toBe(true);
    expect(tracker.observe(ctx({ sessionType: "qualifying", carType: "oval", sim: "lmu" }))).toBe(
      true,
    );
  });

  it("ignores the empty context, so coming back to the same session keeps the group", () => {
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
