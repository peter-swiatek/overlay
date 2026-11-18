import { describe, expect, it } from "vitest";
import {
  LIGHT_COLOUR_VAR,
  clamp01,
  formatGear,
  lightColour,
  shiftLightPoints,
  shiftLightState,
  type LightColour,
} from "./driving";

const car = {
  shiftLights: { firstRpm: 5200, lastRpm: 7400, shiftRpm: 7600, blinkRpm: 7800 },
  redlineRpm: 8000,
};
const noData = { shiftLights: null, redlineRpm: 8000 };

describe("formatGear", () => {
  it("names reverse, neutral and forward gears", () => {
    expect(formatGear(-1)).toBe("R");
    expect(formatGear(0)).toBe("N");
    expect(formatGear(4)).toBe("4");
    expect(formatGear(null)).toBe("-");
  });
});

describe("clamp01", () => {
  it("clamps and treats unknown as 0", () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(3)).toBe(1);
    expect(clamp01(null)).toBe(0);
    expect(clamp01(undefined)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("shiftLightPoints", () => {
  it("spaces car thresholds evenly for 6 steps", () => {
    const p = shiftLightPoints(6, car, "car");
    expect(p?.thresholds).toEqual([5200, 5640, 6080, 6520, 6960, 7400]);
    expect(p?.shiftRpm).toBe(7600);
    expect(p?.blinkRpm).toBe(7800);
  });

  it("spaces car thresholds evenly for 16 steps", () => {
    const p = shiftLightPoints(16, car, "car");
    expect(p?.thresholds).toHaveLength(16);
    expect(p?.thresholds[0]).toBe(5200);
    expect(p?.thresholds[15]).toBe(7400);
    expect(p?.thresholds[1]).toBeCloseTo(5200 + 2200 / 15, 6);
  });

  it("uses 98 % of the redline when the car has no blink point", () => {
    const noBlink = { ...car.shiftLights, blinkRpm: null };
    expect(shiftLightPoints(6, { ...car, shiftLights: noBlink }, "car")?.blinkRpm).toBeCloseTo(
      7840,
      6,
    );
    expect(
      shiftLightPoints(6, { shiftLights: noBlink, redlineRpm: null }, "car")?.blinkRpm,
    ).toBeNull();
  });

  it("uses the custom table for 6 steps", () => {
    const p = shiftLightPoints(6, car, "custom");
    expect(p?.thresholds.map((t) => Math.round(t))).toEqual([6000, 6240, 6400, 6560, 6800, 7200]);
    expect(p?.shiftRpm).toBeCloseTo(7600, 6);
    expect(p?.blinkRpm).toBeCloseTo(7840, 6);
  });

  it("spreads custom thresholds evenly from 75 to 90 % for other counts", () => {
    const p = shiftLightPoints(16, noData, "custom");
    expect(p?.thresholds).toHaveLength(16);
    expect(p?.thresholds[0]).toBeCloseTo(6000, 6);
    expect(p?.thresholds[15]).toBeCloseTo(7200, 6);
  });

  it("falls back to custom for a car without shift-light data", () => {
    expect(shiftLightPoints(6, noData, "car")).toEqual(shiftLightPoints(6, noData, "custom"));
  });

  it("is null without shift-light data and without a redline", () => {
    expect(shiftLightPoints(6, { shiftLights: null, redlineRpm: null }, "car")).toBeNull();
    expect(shiftLightPoints(6, { shiftLights: null, redlineRpm: 0 }, "custom")).toBeNull();
  });
});

describe("shiftLightState", () => {
  const points = shiftLightPoints(6, car, "car");
  it("counts lit steps and flags shift and blink", () => {
    expect(shiftLightState(5000, points)).toEqual({ lit: 0, shift: false, blink: false });
    expect(shiftLightState(6100, points)).toEqual({ lit: 3, shift: false, blink: false });
    expect(shiftLightState(7400, points)).toEqual({ lit: 6, shift: false, blink: false });
    expect(shiftLightState(7600, points)).toEqual({ lit: 6, shift: true, blink: false });
    expect(shiftLightState(7800, points)).toEqual({ lit: 6, shift: true, blink: true });
  });
  it("is dark for unknown rpm or points", () => {
    expect(shiftLightState(null, points)).toEqual({ lit: 0, shift: false, blink: false });
    expect(shiftLightState(7000, null)).toEqual({ lit: 0, shift: false, blink: false });
  });
});

describe("lightColour", () => {
  const bands = (steps: number): string => {
    const out: LightColour[] = [];
    for (let i = 0; i < steps; i++) out.push(lightColour(i, steps));
    const count = (c: LightColour): number => out.filter((x) => x === c).length;
    return [count("green"), count("yellow"), count("red")].join("/");
  };
  it("splits 6 steps 2/2/2 and 16 steps 6/4/6", () => {
    expect(bands(6)).toBe("2/2/2");
    expect(bands(16)).toBe("6/4/6");
    expect(lightColour(0, 6)).toBe("green");
    expect(lightColour(5, 6)).toBe("red");
  });
  it("maps bands to locked variables", () => {
    expect(LIGHT_COLOUR_VAR.green).toBe("var(--ov-locked-gain)");
    expect(LIGHT_COLOUR_VAR.shift).toBe("var(--ov-locked-shift)");
  });
});
