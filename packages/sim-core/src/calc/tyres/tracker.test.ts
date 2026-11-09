import { describe, expect, it } from "vitest";
import { emptyCar, emptySimState, type TyreCorner, type TyreSet } from "../../model";
import { TyreStintTracker, tyreStintInput, type TyreStintInput } from "./tracker";

function corner(wear: number | null): TyreCorner {
  return { temps: { inner: null, middle: null, outer: null }, pressureKpa: null, wear };
}

function set(wear: number | null | readonly (number | null)[], compound = "Medium"): TyreSet {
  const w = Array.isArray(wear) ? wear : [wear, wear, wear, wear];
  return {
    fl: corner(w[0] ?? null),
    fr: corner(w[1] ?? null),
    rl: corner(w[2] ?? null),
    rr: corner(w[3] ?? null),
    frontCompound: compound,
    rearCompound: compound,
  };
}

const tick = (
  lapsCompleted: number | null,
  wear: number | null | readonly (number | null)[],
  compound?: string,
): TyreStintInput => ({ lapsCompleted, tyres: set(wear, compound) });

describe("TyreStintTracker", () => {
  it("counts laps from a set fitted at the start", () => {
    const t = new TyreStintTracker();
    expect(t.next(tick(0, 0))).toEqual({ lapsOnSet: 0 });
    expect(t.next(tick(1, 0.01))).toEqual({ lapsOnSet: 1 });
    expect(t.next(tick(15, 0.07))).toEqual({ lapsOnSet: 15 });
  });

  it("treats unworn rubber seen first mid-session as just fitted", () => {
    const t = new TyreStintTracker();
    expect(t.next(tick(12, 0.002))?.lapsOnSet).toBe(0);
    expect(t.next(tick(14, 0.02))?.lapsOnSet).toBe(2);
  });

  it("does not know the age of a used set seen first mid-session, until the next set", () => {
    const t = new TyreStintTracker();
    expect(t.next(tick(12, 0.2))).toEqual({ lapsOnSet: null });
    expect(t.next(tick(13, 0.22))).toEqual({ lapsOnSet: null });
    // Pit stop: fresh rubber on lap 20.
    expect(t.next(tick(20, 0))).toEqual({ lapsOnSet: 0 });
    expect(t.next(tick(23, 0.03))).toEqual({ lapsOnSet: 3 });
  });

  it("starts a new count when one corner's wear falls or the compound changes", () => {
    const t = new TyreStintTracker();
    t.next(tick(0, 0));
    t.next(tick(10, 0.1));
    // A change of the fronts only still restarts the count.
    expect(t.next(tick(10, [0, 0, 0.1, 0.1]))?.lapsOnSet).toBe(0);
    expect(t.next(tick(12, [0.02, 0.02, 0.12, 0.12]))?.lapsOnSet).toBe(2);
    // Same wear, other compound.
    expect(t.next(tick(14, [0.02, 0.02, 0.12, 0.12], "Hard"))?.lapsOnSet).toBe(0);
  });

  it("ignores wear noise below the threshold and unknown corners", () => {
    const t = new TyreStintTracker();
    t.next(tick(0, 0));
    t.next(tick(5, 0.05));
    expect(t.next(tick(6, 0.045))?.lapsOnSet).toBe(6);
    expect(t.next(tick(7, [null, 0.05, 0.05, 0.05]))?.lapsOnSet).toBe(7);
  });

  it("is null without tyres or a lap count and restarts after a reset or a lap counter going back", () => {
    const t = new TyreStintTracker();
    expect(t.next({ lapsCompleted: 3, tyres: null })).toBeNull();
    expect(t.next(tick(null, 0))).toBeNull();
    t.next(tick(2, 0));
    expect(t.next(tick(4, 0.02))?.lapsOnSet).toBe(2);
    expect(t.next(tick(1, 0.02))?.lapsOnSet).toBe(0);
    t.reset();
    expect(t.next(tick(9, 0.3))?.lapsOnSet).toBeNull();
  });
});

describe("tyreStintInput", () => {
  it("takes the player's lap count and tyres", () => {
    const s = emptySimState("lmu");
    const car = emptyCar(3);
    car.lapsCompleted = 7;
    s.cars = [emptyCar(0), car];
    s.playerCarIdx = 3;
    s.player.tyres = set(0.1);
    expect(tyreStintInput(s)).toEqual({ lapsCompleted: 7, tyres: s.player.tyres });
    s.playerCarIdx = null;
    expect(tyreStintInput(s).lapsCompleted).toBeNull();
  });
});
