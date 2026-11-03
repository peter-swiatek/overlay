// Tests may use the sim-core entry for fixtures; overlay code itself must not.
import { emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { describe, expect, it } from "vitest";
import { barValue, inputsView, wheelAngleDeg } from "./view";

function liveFrame(): TelemetryFrame {
  return {
    seq: 1,
    source: "mock",
    status: "live",
    error: null,
    state: emptySimState("mock"),
    derived: {
      fuel: null,
      energy: null,
      track: { trackKey: null, outlineReady: false },
      standings: null,
      proximity: null,
      delta: null,
      slowCar: null,
      gaps: [],
    },
  };
}

describe("inputsView", () => {
  it("clamps the pedals and the wheel and keeps speed in m/s", () => {
    const frame = liveFrame();
    frame.state.player.inputs = { throttle: 0.4, brake: 1.5, clutch: -1, steer: -2 };
    frame.state.player.gear = 4;
    frame.state.player.speedMps = 50;
    frame.state.tickTimeS = 12.5;
    expect(inputsView(frame)).toMatchObject({
      active: true,
      throttle: 0.4,
      brake: 1,
      clutch: 0,
      steer: -1,
      gear: 4,
      speedMps: 50,
      tickTimeS: 12.5,
    });
  });

  it("treats unknown values as zero or null", () => {
    const v = inputsView(liveFrame());
    expect(v).toMatchObject({ throttle: 0, brake: 0, clutch: 0, steer: 0, abs: false });
    expect(v.gear).toBeNull();
    expect(v.speedMps).toBeNull();
    expect(v.tickTimeS).toBeNull();
  });

  it("reports ABS only when the sim says so", () => {
    const frame = liveFrame();
    frame.state.player.absActive = true;
    expect(inputsView(frame).abs).toBe(true);
    frame.state.player.absActive = null;
    expect(inputsView(frame).abs).toBe(false);
  });

  it("is idle unless live", () => {
    const frame = liveFrame();
    frame.state.player.speedMps = 50;
    expect(inputsView({ ...frame, status: "waiting" })).toMatchObject({
      active: false,
      speedMps: null,
    });
    expect(inputsView(null).active).toBe(false);
  });
});

describe("wheelAngleDeg", () => {
  it("scales by the car's lock", () => {
    expect(wheelAngleDeg(0.5, Math.PI * 2)).toBeCloseTo(180);
    expect(wheelAngleDeg(-1, Math.PI / 2)).toBeCloseTo(-90);
  });

  it("assumes 180 degrees each side without a lock", () => {
    expect(wheelAngleDeg(1, null)).toBeCloseTo(180);
    expect(wheelAngleDeg(-0.5, null)).toBeCloseTo(-90);
    expect(wheelAngleDeg(1, 0)).toBeCloseTo(180);
  });

  it("flows through the view", () => {
    const frame = liveFrame();
    frame.state.player.inputs.steer = 0.5;
    frame.state.player.steerMaxRad = Math.PI * 2;
    expect(inputsView(frame).wheelDeg).toBeCloseTo(180);
  });
});

describe("barValue", () => {
  it("rounds to 0..100", () => {
    expect([0, 0.456, 1, 2, -1].map(barValue)).toEqual([0, 46, 100, 100, 0]);
  });
});
