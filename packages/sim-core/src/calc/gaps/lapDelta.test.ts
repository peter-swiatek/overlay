import { describe, expect, it } from "vitest";
import { lapDelta } from "./index";

const p = (lapsCompleted: number | null, lapDistPct: number | null) => ({
  lapsCompleted,
  lapDistPct,
});

describe("lapDelta", () => {
  it("is 0 for a car on the same lap, ahead or behind on track", () => {
    expect(lapDelta(p(5, 0.4), p(5, 0.6))).toBe(0);
    expect(lapDelta(p(5, 0.4), p(5, 0.2))).toBe(0);
    expect(lapDelta(p(5, 0.4), p(5, 0.4))).toBe(0);
  });

  it("is +1 for a car a lap up, wherever it is on track", () => {
    // Just ahead on track and a full lap up in distance: it is lapping the player.
    expect(lapDelta(p(5, 0.4), p(6, 0.45))).toBe(1);
    // Just behind on track but still a lap up: it is about to lap the player.
    expect(lapDelta(p(5, 0.4), p(6, 0.35))).toBe(1);
    // Nearly half a lap away either way.
    expect(lapDelta(p(5, 0.1), p(6, 0.55))).toBe(1);
    expect(lapDelta(p(5, 0.6), p(6, 0.2))).toBe(1);
    // 1.55 laps up in distance but 0.45 behind on track: about to lap the player a second time.
    expect(lapDelta(p(5, 0.1), p(6, 0.65))).toBe(2);
    // Only 0.4 laps up in distance: same lap, just ahead across the line.
    expect(lapDelta(p(5, 0.9), p(6, 0.3))).toBe(0);
  });

  it("is negative for cars the player has lapped", () => {
    expect(lapDelta(p(5, 0.4), p(4, 0.45))).toBe(-1);
    expect(lapDelta(p(5, 0.4), p(4, 0.3))).toBe(-1);
    expect(lapDelta(p(8, 0.4), p(5, 0.5))).toBe(-3);
  });

  it("gives more than one lap", () => {
    expect(lapDelta(p(3, 0.2), p(5, 0.25))).toBe(2);
  });

  it("keeps cars either side of the start/finish line on the same lap", () => {
    // The car has crossed the line, the player has not: physically just ahead, same lap.
    expect(lapDelta(p(5, 0.98), p(6, 0.02))).toBe(0);
    // The player has crossed, the car has not: just behind, same lap.
    expect(lapDelta(p(6, 0.02), p(5, 0.98))).toBe(0);
    // A lap-up car that has just crossed the line ahead of the player.
    expect(lapDelta(p(5, 0.98), p(7, 0.02))).toBe(1);
    // A lapped car just short of the line behind a player who has crossed it.
    expect(lapDelta(p(6, 0.02), p(4, 0.98))).toBe(-1);
  });

  it("counts a car exactly half a lap away as ahead on track", () => {
    // Half a lap up in distance and drawn ahead: same lap.
    expect(lapDelta(p(5, 0.0), p(5, 0.5))).toBe(0);
    // Half a lap down in distance yet drawn ahead: a lap down.
    expect(lapDelta(p(5, 0.5), p(5, 0.0))).toBe(-1);
  });

  it("still counts a car in the pit lane, which keeps its laps and position", () => {
    expect(lapDelta(p(10, 0.95), p(9, 0.97))).toBe(-1);
  });

  it("is null when laps or position are unknown", () => {
    expect(lapDelta(p(null, 0.4), p(5, 0.4))).toBeNull();
    expect(lapDelta(p(5, 0.4), p(null, 0.4))).toBeNull();
    expect(lapDelta(p(5, null), p(5, 0.4))).toBeNull();
    expect(lapDelta(p(5, 0.4), p(5, -1))).toBeNull();
    expect(lapDelta(p(5, 0.4), p(5, Number.NaN))).toBeNull();
    expect(lapDelta(p(-1, 0.4), p(5, 0.4))).toBeNull();
  });
});
