import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { ringArc, RING_LENGTH } from "./ring";
import { EDIT_SAMPLE, ledStates, stripView } from "./view";

const DEMO_CAR = {
  shiftLights: { firstRpm: 5200, lastRpm: 7400, shiftRpm: 7600, blinkRpm: 7800 },
  redlineRpm: 8000,
};

function frame(
  opts: {
    rpm?: number;
    player?: Parameters<typeof fixtureFrame>[0]["player"];
    type?: "race" | "practice";
    start?: number | null;
    position?: number;
    livePosition?: number;
  } = {},
) {
  return fixtureFrame({
    cars: [{ carIdx: 2 }],
    playerCarIdx: 2,
    session: { type: opts.type ?? "race" },
    standings: [
      {
        carIdx: 2,
        position: opts.position ?? 14,
        livePosition: opts.livePosition ?? 13,
        startPosition: opts.start === undefined ? 20 : opts.start,
      },
    ],
    conditions: { trackTempC: 43.2 },
    player: {
      isOnTrack: true,
      gear: 4,
      speedMps: 40,
      rpm: opts.rpm ?? 6000,
      fuelL: 39,
      fuelCapacityL: 50,
      inputs: { throttle: 0.5, brake: 0.2, clutch: 0, steer: 0 },
      ...DEMO_CAR,
      lap: { currentLapS: 10, lastLapS: 111, bestLapS: 110, delta: null },
      ...opts.player,
    },
  });
}

describe("ringArc", () => {
  it("hides an empty arc and fills a full circle with butt caps", () => {
    expect(ringArc(0, 0).show).toBe(false);
    const full = ringArc(0, 360);
    expect(full).toMatchObject({ show: true, cap: "butt", rotateDeg: -90 });
    const c = RING_LENGTH.toFixed(2);
    expect(full.dasharray).toBe(`${c} ${c}`);
  });

  it("keeps round caps inside a 21 % throttle span", () => {
    const span = 0.21 * 360;
    const a = ringArc(0, span);
    expect(a.cap).toBe("round");
    // The dash plus a cap at each end covers exactly the span.
    const dash = Number(a.dasharray.split(" ")[0]);
    const capDeg = ((4 / 63) * 180) / Math.PI;
    expect((dash / RING_LENGTH) * 360 + 2 * capDeg).toBeCloseTo(span, 1);
    // The dash starts one cap after 12 o'clock (-90 is 12 o'clock for an SVG circle).
    expect(a.rotateDeg).toBeCloseTo(-90 + capDeg, 5);
  });

  it("mirrors the brake anticlockwise from 12 o'clock", () => {
    const span = 0.21 * 360;
    const t = ringArc(0, span);
    const b = ringArc(-span, span);
    expect(b.dasharray).toBe(t.dasharray);
    // The mirrored arc ends at 12 o'clock: start + span (including the cap) is 12.
    const capDeg = ((4 / 63) * 180) / Math.PI;
    const dash = Number(b.dasharray.split(" ")[0]);
    const endDeg = b.rotateDeg + 90 + (dash / RING_LENGTH) * 360 + capDeg;
    expect(endDeg).toBeCloseTo(0, 1);
  });

  it("hides arcs too short for both caps and clamps the span", () => {
    expect(ringArc(0, 3).show).toBe(false);
    expect(ringArc(0, 500).cap).toBe("butt");
    expect(ringArc(0, Number.NaN).show).toBe(false);
  });
});

describe("ledStates", () => {
  it("lights nothing below the first light", () => {
    const { leds, blink } = ledStates(5000, DEMO_CAR, "car");
    expect(leds.every((l) => l === null)).toBe(true);
    expect(blink).toBe(false);
  });

  it("lights a prefix in band colours", () => {
    const { leds } = ledStates(6400, DEMO_CAR, "car");
    expect(leds.filter((l) => l !== null)).toHaveLength(9);
    expect(leds.slice(0, 6).every((l) => l === "green")).toBe(true);
    expect(leds.slice(6, 9).every((l) => l === "yellow")).toBe(true);
    expect(leds[9]).toBeNull();
  });

  it("turns every light to the shift colour at the shift point and blinks from the blink point", () => {
    const atShift = ledStates(7600, DEMO_CAR, "car");
    expect(atShift.leds.every((l) => l === "shift")).toBe(true);
    expect(atShift.blink).toBe(false);
    expect(ledStates(7800, DEMO_CAR, "car").blink).toBe(true);
  });

  it("uses shares of the redline for the custom source", () => {
    // 75 % of 8000 = 6000 first light; 95 % = 7600 shift; 98 % = 7840 blink.
    expect(ledStates(5999, DEMO_CAR, "custom").leds.some((l) => l !== null)).toBe(false);
    expect(ledStates(6000, DEMO_CAR, "custom").leds[0]).toBe("green");
    expect(ledStates(7600, DEMO_CAR, "custom").leds[15]).toBe("shift");
    expect(ledStates(7840, DEMO_CAR, "custom").blink).toBe(true);
  });

  it("falls back to the custom pattern for cars without shift-light data", () => {
    const car = { shiftLights: null, redlineRpm: 8000 };
    expect(ledStates(6000, car, "car").leds[0]).toBe("green");
    const none = ledStates(6000, { shiftLights: null, redlineRpm: null }, "car");
    expect(none.leds.every((l) => l === null)).toBe(true);
  });
});

describe("stripView", () => {
  it("is inactive without a frame, when not live or off track", () => {
    expect(stripView(null, true, "car").active).toBe(false);
    const waiting = frame();
    waiting.status = "waiting";
    expect(stripView(waiting, true, "car").active).toBe(false);
    expect(stripView(frame({ player: { isOnTrack: false } }), true, "car").active).toBe(false);
    expect(stripView(frame({ player: { isOnTrack: null } }), true, "car").active).toBe(false);
  });

  it("reads the drive values", () => {
    const v = stripView(frame(), true, "car");
    expect(v).toMatchObject({
      active: true,
      gear: 4,
      speedMps: 40,
      rpm: 6000,
      throttle: 0.5,
      brake: 0.2,
      lastLapS: 111,
      trackTempC: 43.2,
    });
    expect(v.leds).toHaveLength(16);
  });

  it("gives the fuel fraction, null without capacity", () => {
    expect(stripView(frame(), true, "car").fuelFraction).toBeCloseTo(0.78, 5);
    expect(
      stripView(frame({ player: { fuelCapacityL: null } }), true, "car").fuelFraction,
    ).toBeNull();
    expect(stripView(frame({ player: { fuelCapacityL: 0 } }), true, "car").fuelFraction).toBeNull();
  });

  it("takes the live or the official position", () => {
    expect(stripView(frame(), true, "car").position).toBe(13);
    expect(stripView(frame(), false, "car").position).toBe(14);
  });

  it("counts places gained since the start in a race only", () => {
    expect(stripView(frame({ position: 14, livePosition: 14 }), true, "car").placesGained).toBe(6);
    expect(stripView(frame({ position: 22, livePosition: 22 }), true, "car").placesGained).toBe(-2);
    expect(stripView(frame({ position: 20, livePosition: 20 }), true, "car").placesGained).toBe(0);
    expect(stripView(frame({ start: null }), true, "car").placesGained).toBeNull();
    expect(stripView(frame({ type: "practice" }), true, "car").placesGained).toBeNull();
  });

  it("has null for unknowns, never 0", () => {
    const v = stripView(
      frame({ player: { speedMps: null, rpm: null, gear: null, lap: null } }),
      true,
      "car",
    );
    expect(v.speedMps).toBeNull();
    expect(v.rpm).toBeNull();
    expect(v.gear).toBeNull();
    expect(v.lastLapS).toBeNull();
  });
});

describe("EDIT_SAMPLE", () => {
  it("is the board's live scenario", () => {
    expect(EDIT_SAMPLE).toMatchObject({
      active: true,
      gear: 6,
      rpm: 7590,
      position: 14,
      placesGained: 6,
      fuelFraction: 0.78,
      lastLapS: 111,
      trackTempC: 43,
      throttle: 1,
      brake: 0.21,
    });
    expect((EDIT_SAMPLE.speedMps ?? 0) * 3.6).toBeCloseTo(157, 5);
    expect(EDIT_SAMPLE.leds.filter((l) => l !== null)).toHaveLength(10);
  });
});
