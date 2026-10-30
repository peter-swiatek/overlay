import { emptyCar, emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { describe, expect, it } from "vitest";
import { formatGap, formatGear, formatLap, inputsView, relativeRows, statusNotice } from "./views";

function liveFrame(gaps: Record<number, number | null>, player: number | null = 0): TelemetryFrame {
  const state = emptySimState("mock");
  state.playerCarIdx = player;
  const idxs = [...(player === null ? [] : [player]), ...Object.keys(gaps).map(Number)];
  state.cars = idxs.map((carIdx) => ({
    ...emptyCar(carIdx),
    driverName: `Car ${carIdx}`,
    carNumber: String(carIdx),
    classColour: "#ffda59",
    position: carIdx + 1,
  }));
  return {
    seq: 1,
    source: "mock",
    status: "live",
    error: null,
    state,
    derived: {
      fuel: null,
      gaps: Object.entries(gaps).map(([carIdx, gapS]) => ({
        carIdx: Number(carIdx),
        gapS,
        tier: "position" as never,
      })),
    },
  };
}

describe("relativeRows", () => {
  it("shows three cars ahead (furthest first), the player, three behind (nearest first)", () => {
    const rows = relativeRows(
      liveFrame({ 1: -9, 2: -1, 3: -4, 4: -0.5, 5: 0.7, 6: 8, 7: 2, 8: 3, 9: 40 }),
    );
    expect(rows.map((r) => r.carIdx)).toEqual([3, 2, 4, 0, 5, 7, 8]);
    expect(rows.filter((r) => r.isPlayer).map((r) => r.carIdx)).toEqual([0]);
  });

  it("carries class colour, car number, name and gap", () => {
    const rows = relativeRows(liveFrame({ 1: -0.8 }));
    expect(rows[0]).toMatchObject({
      carIdx: 1,
      carNumber: "1",
      name: "Car 1",
      classColour: "#ffda59",
      gapS: -0.8,
    });
    expect(rows[1]).toMatchObject({ carIdx: 0, isPlayer: true, gapS: null });
  });

  it("leaves out cars without a gap and shows fewer rows near the front or back", () => {
    const rows = relativeRows(liveFrame({ 1: null, 2: 1.5 }));
    expect(rows.map((r) => r.carIdx)).toEqual([0, 2]);
  });

  it("works without a player and ignores gaps for unknown cars", () => {
    const frame = liveFrame({ 1: 1 }, null);
    frame.derived.gaps.push({ carIdx: 99, gapS: 2, tier: "position" as never });
    expect(relativeRows(frame).map((r) => r.carIdx)).toEqual([1]);
  });

  it("is empty unless live (waiting frames carry an empty state)", () => {
    expect(relativeRows(null)).toEqual([]);
    expect(relativeRows({ ...liveFrame({ 1: 1 }), status: "waiting" })).toEqual([]);
    expect(relativeRows({ ...liveFrame({ 1: 1 }), status: "error", error: "x" })).toEqual([]);
  });
});

describe("inputsView", () => {
  it("converts and clamps the player's inputs", () => {
    const frame = liveFrame({});
    frame.state.player.inputs = { throttle: 0.4, brake: 1.5, clutch: null, steer: -2 };
    frame.state.player.gear = 4;
    frame.state.player.speedMps = 50;
    expect(inputsView(frame)).toEqual({
      throttle: 0.4,
      brake: 1,
      clutch: 0,
      steer: -1,
      gear: 4,
      speedKph: 180,
    });
  });

  it("is all zero unless live", () => {
    const frame = liveFrame({});
    frame.state.player.speedMps = 50;
    expect(inputsView({ ...frame, status: "waiting" }).speedKph).toBe(0);
    expect(inputsView(null).throttle).toBe(0);
  });
});

describe("statusNotice", () => {
  it("shows Waiting for sim before data and while waiting", () => {
    expect(statusNotice(null)).toBe("Waiting for sim");
    expect(statusNotice({ ...liveFrame({}), status: "waiting" })).toBe("Waiting for sim");
  });

  it("shows No data when the stream is stale", () => {
    expect(statusNotice(liveFrame({}), true)).toBe("No data");
    expect(statusNotice(null, true)).toBe("No data");
  });

  it("shows the error text, and nothing when live", () => {
    expect(statusNotice({ ...liveFrame({}), status: "error", error: "Cannot open file" })).toBe(
      "Cannot open file",
    );
    expect(statusNotice(liveFrame({}))).toBeNull();
  });
});

describe("formatters", () => {
  it("formats gaps, laps and gears", () => {
    expect(formatGap(-0.84)).toBe("-0.8");
    expect(formatGap(1.26)).toBe("+1.3");
    expect(formatGap(null)).toBe("-");
    expect(formatLap(92.5)).toBe("1:32.500");
    expect(formatLap(null)).toBe("-");
    expect([-1, 0, 3].map(formatGear)).toEqual(["R", "N", "3"]);
  });
});
