import { emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { describe, expect, it } from "vitest";
import { EDIT_SAMPLE, compassName, weatherView, wetnessLabel } from "./view";

const rad = (deg: number) => (deg * Math.PI) / 180;

function frame(): TelemetryFrame {
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

describe("weatherView", () => {
  it("is empty without a live frame", () => {
    expect(weatherView(null).live).toBe(false);
    const f = frame();
    f.status = "waiting";
    expect(weatherView(f)).toEqual(weatherView(null));
  });

  it("turns the dial by minus the heading and points the arrow where the wind blows to", () => {
    const f = frame();
    f.state.player.yawRad = rad(270);
    f.state.conditions.windDirRad = rad(90);
    const v = weatherView(f);
    expect(v.dialDeg).toBeCloseTo(90);
    expect(v.arrowDeg).toBeCloseTo(0);
    expect(v.windFrom).toBe("E");
  });

  it("wraps the arrow and the dial into 0..360", () => {
    const f = frame();
    f.state.player.yawRad = rad(10);
    f.state.conditions.windDirRad = rad(350);
    const v = weatherView(f);
    expect(v.dialDeg).toBeCloseTo(350);
    expect(v.arrowDeg).toBeCloseTo(160);
    f.state.player.yawRad = 0;
    f.state.conditions.windDirRad = 0;
    expect(weatherView(f).dialDeg).toBe(0);
    expect(weatherView(f).arrowDeg).toBeCloseTo(180);
  });

  it("has no dial or arrow without a heading, and no arrow without a wind direction", () => {
    const f = frame();
    f.state.conditions.windDirRad = rad(90);
    expect(weatherView(f).dialDeg).toBeNull();
    expect(weatherView(f).arrowDeg).toBeNull();
    f.state.player.yawRad = rad(90);
    f.state.conditions.windDirRad = null;
    const v = weatherView(f);
    expect(v.dialDeg).toBeCloseTo(270);
    expect(v.arrowDeg).toBeNull();
    expect(v.windFrom).toBeNull();
  });

  it("names the 8 compass points", () => {
    const names = [0, 45, 90, 135, 180, 225, 270, 315, 360, 22, 23, 337].map(compassName);
    expect(names).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N", "N", "NE", "NW"]);
  });

  it("labels wetness at the thresholds", () => {
    expect([0, 0.04, 0.05, 0.17, 0.33, 0.49, 0.5, 1].map(wetnessLabel)).toEqual([
      "dry",
      "dry",
      "damp",
      "damp",
      "damp",
      "damp",
      "wet",
      "wet",
    ]);
    expect(wetnessLabel(null)).toBeNull();
  });

  it("cleans the usage text", () => {
    const f = frame();
    f.state.session.trackUsage = "moderate usage";
    expect(weatherView(f).usage).toBe("Moderate");
    f.state.session.trackUsage = "carried marbles";
    expect(weatherView(f).usage).toBe("Carried marbles");
    f.state.session.trackUsage = null;
    expect(weatherView(f).usage).toBeNull();
  });

  it("copies the conditions and keeps unknown as null", () => {
    const f = frame();
    f.state.conditions.trackTempC = 30;
    f.state.conditions.humidity = 0.4;
    f.state.conditions.wetness = 0.6;
    const v = weatherView(f);
    expect(v.trackTempC).toBe(30);
    expect(v.airTempC).toBeNull();
    expect(v.humidity).toBe(0.4);
    expect(v.precipitation).toBeNull();
    expect(v.wetnessLabel).toBe("wet");
  });

  it("has an edit sample that matches the dry board", () => {
    expect(EDIT_SAMPLE.trackTempC).toBe(28);
    expect(EDIT_SAMPLE.airTempC).toBe(22);
    expect(EDIT_SAMPLE.windFrom).toBe("E");
    expect(EDIT_SAMPLE.wetnessLabel).toBe("dry");
  });
});
