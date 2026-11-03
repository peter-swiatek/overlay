import type { Player, TelemetryFrame } from "@overlay/sim-core/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { hudShape } from "./shape";
import { compactHudView, lapLine, pinPx, proximityLevel, type HudOptions } from "./view";

const OPTIONS: HudOptions = {
  gapRangeS: 5,
  showGapTabs: true,
  showProximity: true,
  showPitCountdown: true,
  showSlowCar: true,
  slowCarRangeM: 300,
  shiftSource: "car",
};

const CAR: Pick<Player, "shiftLights" | "redlineRpm"> = {
  shiftLights: { firstRpm: 5200, shiftRpm: 7600, lastRpm: 7400, blinkRpm: 7800 },
  redlineRpm: 8000,
};

function frame(
  opts: {
    player?: Partial<Player>;
    typeName?: string | null;
    meLap?: number;
    meDist?: number;
    others?: Array<{
      carIdx: number;
      gapS: number;
      laps?: number;
      dist?: number;
      onPitRoad?: boolean;
      isOnTrack?: boolean;
    }>;
  } = {},
): TelemetryFrame {
  const others = opts.others ?? [];
  const f = fixtureFrame({
    playerCarIdx: 0,
    session: { trackLengthM: 4000, typeName: opts.typeName ?? "Race" },
    player: {
      isOnTrack: true,
      speedMps: 40,
      rpm: 6000,
      gear: 4,
      ...CAR,
      inputs: { throttle: 0.5, brake: 0.2, clutch: 0, steer: 0 },
      ...opts.player,
    },
    cars: [
      {
        carIdx: 0,
        lapsCompleted: opts.meLap ?? 3,
        lapDistPct: opts.meDist ?? 0.5,
        onPitRoad: false,
        isOnTrack: true,
      },
      ...others.map((o) => ({
        carIdx: o.carIdx,
        lapsCompleted: o.laps ?? 3,
        lapDistPct: o.dist ?? 0.5,
        onPitRoad: o.onPitRoad ?? false,
        isOnTrack: o.isOnTrack ?? true,
      })),
    ],
    gaps: others.map((o) => ({ carIdx: o.carIdx, gapS: o.gapS, tier: "estimate" as never })),
  });
  return f;
}

describe("compactHudView: activity", () => {
  it("is inactive without a frame, when not live, or off track", () => {
    expect(compactHudView(null, OPTIONS).active).toBe(false);
    const f = frame();
    f.status = "waiting";
    expect(compactHudView(f, OPTIONS).active).toBe(false);
    expect(compactHudView(frame({ player: { isOnTrack: false } }), OPTIONS).active).toBe(false);
    expect(compactHudView(frame({ player: { isOnTrack: null } }), OPTIONS).active).toBe(false);
    expect(compactHudView(frame(), OPTIONS).active).toBe(true);
  });

  it("reads speed, gear, rpm and abs", () => {
    const v = compactHudView(frame({ player: { absActive: true, speedMps: 46.67 } }), OPTIONS);
    expect(v.speedMps).toBeCloseTo(46.7, 5);
    expect(v.gear).toBe(4);
    expect(v.rpm).toBe(6000);
    expect(v.abs).toBe(true);
  });
});

describe("compactHudView: shift lights", () => {
  const lights = (rpm: number, source: HudOptions["shiftSource"] = "car", car = {}) =>
    compactHudView(frame({ player: { rpm, ...car } }), { ...OPTIONS, shiftSource: source }).lights;

  it("lights steps between the first and last rpm", () => {
    expect(lights(5000).lit).toBe(0);
    expect(lights(5200).lit).toBe(1);
    expect(lights(6600).lit).toBe(4);
    expect(lights(7400).lit).toBe(6);
  });
  it("turns every light to the shift colour at the shift point and blinks at the blink point", () => {
    expect(lights(7500)).toEqual({ lit: 6, shift: false, blink: false });
    expect(lights(7600)).toEqual({ lit: 6, shift: true, blink: false });
    expect(lights(7800)).toEqual({ lit: 6, shift: true, blink: true });
  });
  it("uses the custom share of the redline", () => {
    expect(lights(5900, "custom").lit).toBe(0);
    expect(lights(6000, "custom").lit).toBe(1);
    expect(lights(7600, "custom").shift).toBe(true);
    expect(lights(7840, "custom").blink).toBe(true);
  });
  it("falls back to the custom points without car data and shows none without a redline", () => {
    expect(lights(6000, "car", { shiftLights: null }).lit).toBe(1);
    expect(lights(7000, "car", { shiftLights: null, redlineRpm: null }).lit).toBe(0);
  });
});

describe("compactHudView: arcs and steering", () => {
  it("clamps the arcs to 0..1", () => {
    const v = compactHudView(
      frame({ player: { inputs: { throttle: 1.4, brake: -0.2, clutch: null, steer: 0 } } }),
      OPTIONS,
    );
    expect(v.throttle).toBe(1);
    expect(v.brake).toBe(0);
    const n = compactHudView(
      frame({ player: { inputs: { throttle: null, brake: null, clutch: null, steer: null } } }),
      OPTIONS,
    );
    expect(n.throttle).toBe(0);
    expect(n.brake).toBe(0);
  });

  it("places the steering dot at the ends and the centre", () => {
    expect(pinPx(-1)).toBe(0);
    expect(pinPx(0)).toBe(108);
    expect(pinPx(1)).toBe(216);
    expect(pinPx(3)).toBe(216);
    expect(pinPx(-0.18)).toBe(89);
    expect(pinPx(null)).toBe(108);
  });
});

describe("compactHudView: gap tabs", () => {
  it("picks the nearest car ahead and behind", () => {
    const v = compactHudView(
      frame({
        others: [
          { carIdx: 1, gapS: -3.4 },
          { carIdx: 2, gapS: -1.24 },
          { carIdx: 3, gapS: 0.84 },
          { carIdx: 4, gapS: 2 },
        ],
      }),
      OPTIONS,
    );
    expect(v.ahead?.gapS).toBeCloseTo(1.2, 5);
    expect(v.behind?.gapS).toBeCloseTo(0.8, 5);
  });

  it("hides a tab beyond the range and all tabs when the option is off", () => {
    const f = frame({
      others: [
        { carIdx: 1, gapS: -5.5 },
        { carIdx: 2, gapS: 4.9 },
      ],
    });
    const v = compactHudView(f, OPTIONS);
    expect(v.ahead).toBeNull();
    expect(v.behind).not.toBeNull();
    expect(compactHudView(f, { ...OPTIONS, gapRangeS: 6 }).ahead).not.toBeNull();
    const off = compactHudView(f, { ...OPTIONS, showGapTabs: false });
    expect(off.ahead).toBeNull();
    expect(off.behind).toBeNull();
  });

  it("ignores cars on pit road or off track", () => {
    const v = compactHudView(
      frame({
        others: [
          { carIdx: 1, gapS: -0.5, onPitRoad: true },
          { carIdx: 2, gapS: -1, isOnTrack: false },
          { carIdx: 3, gapS: -2 },
        ],
      }),
      OPTIONS,
    );
    expect(v.ahead?.gapS).toBe(2);
  });

  it("marks the lap lines both ways and none on the same lap", () => {
    const v = compactHudView(
      frame({
        others: [
          { carIdx: 1, gapS: -1, laps: 4 },
          { carIdx: 2, gapS: 1, laps: 2 },
        ],
      }),
      OPTIONS,
    );
    expect(v.ahead?.lapLine).toBe("lapped");
    expect(v.behind?.lapLine).toBe("lapping");
    const same = compactHudView(frame({ others: [{ carIdx: 1, gapS: -1 }] }), OPTIONS);
    expect(same.ahead?.lapLine).toBeNull();
    expect(lapLine(-0.5)).toBe("lapping");
    expect(lapLine(0.49)).toBeNull();
    expect(lapLine(1)).toBe("lapped");
  });

  it("hides gaps and proximity in Lone Qualify", () => {
    const f = frame({ typeName: "lone qualify", others: [{ carIdx: 1, gapS: -1 }] });
    f.derived.proximity = proximity([{ carIdx: 1, longitudinalM: 3 }]);
    const v = compactHudView(f, OPTIONS);
    expect(v.ahead).toBeNull();
    expect(v.proximityAhead).toBeNull();
  });
});

function proximity(nearby: Array<{ carIdx: number; longitudinalM: number }>) {
  return {
    carLeftRight: "clear" as never,
    left: null,
    right: null,
    nearby: nearby.map((n) => ({ ...n, lateralM: null, side: null })),
    carLengthM: 4.5,
  };
}

describe("compactHudView: proximity", () => {
  it("has three levels", () => {
    expect(proximityLevel(4.9)).toBe("close");
    expect(proximityLevel(-5)).toBe("near");
    expect(proximityLevel(9.9)).toBe("near");
    expect(proximityLevel(16.9)).toBe("far");
    expect(proximityLevel(17)).toBeNull();
    expect(proximityLevel(null)).toBeNull();
  });

  it("uses the nearest car in front and behind", () => {
    const f = frame();
    f.derived.proximity = proximity([
      { carIdx: 1, longitudinalM: -3 },
      { carIdx: 2, longitudinalM: 8 },
      { carIdx: 3, longitudinalM: 15 },
    ]);
    const v = compactHudView(f, OPTIONS);
    expect(v.proximityAhead).toBe("near");
    expect(v.proximityBehind).toBe("close");
    expect(compactHudView(f, { ...OPTIONS, showProximity: false }).proximityAhead).toBeNull();
  });
});

describe("compactHudView: status pill", () => {
  const pit = (dist: number, extra: Partial<Player> = {}) =>
    frame({
      meDist: 0.9,
      player: { trackSurface: "approachingPits", pitStallLapDistPct: dist, ...extra },
    });

  it("counts down to the pit box with a fill of 0 at 500 m, 0.5 at 250 m and 1 at the box", () => {
    expect(compactHudView(pit(0.9 + 500 / 4000), OPTIONS).status).toEqual({
      kind: "pit",
      distanceM: 500,
      fill: 0,
    });
    expect(compactHudView(pit(0.9 + 250 / 4000), OPTIONS).status).toMatchObject({ fill: 0.5 });
    expect(compactHudView(pit(0.9), OPTIONS).status).toMatchObject({ distanceM: 0, fill: 1 });
  });

  it("wraps over the line and is hidden beyond 500 m, off pit approach, or when switched off", () => {
    const f = frame({
      meDist: 0.95,
      player: { trackSurface: "approachingPits", pitStallLapDistPct: 0.02 },
    });
    expect(compactHudView(f, OPTIONS).status).toMatchObject({ kind: "pit", distanceM: 280 });
    expect(compactHudView(pit(0.9 + 600 / 4000), OPTIONS).status).toBeNull();
    expect(compactHudView(pit(0.95, { trackSurface: "onTrack" }), OPTIONS).status).toBeNull();
    expect(compactHudView(pit(0.95), { ...OPTIONS, showPitCountdown: false }).status).toBeNull();
  });

  it("shows the slow car within range and before the pit pill", () => {
    const f = pit(0.95);
    f.derived.slowCar = { carIdx: 5, distanceM: 180.4, speedMps: 8, stopped: false };
    expect(compactHudView(f, OPTIONS).status).toEqual({ kind: "slow", distanceM: 180 });
    f.derived.slowCar = { carIdx: 5, distanceM: 301, speedMps: 8, stopped: false };
    expect(compactHudView(f, OPTIONS).status?.kind).toBe("pit");
    f.derived.slowCar = { carIdx: 5, distanceM: 100, speedMps: 8, stopped: false };
    expect(compactHudView(f, { ...OPTIONS, showSlowCar: false }).status?.kind).toBe("pit");
  });
});

describe("compactHudView: limiter", () => {
  it("follows the pit limiter", () => {
    expect(compactHudView(frame({ player: { pitLimiter: true } }), OPTIONS).limiter).toBe(true);
    expect(compactHudView(frame({ player: { pitLimiter: null } }), OPTIONS).limiter).toBe(false);
  });
});

describe("hudShape", () => {
  it("builds the four tab combinations", () => {
    const base = "M55,48 L285,48 A50,50 0 0 1 285,148 L55,148 A50,50 0 0 1 55,48 Z";
    expect(hudShape(false, false)).toBe(base);
    expect(hudShape(true, false)).toContain("C112,48 110,28 126,28");
    expect(hudShape(true, false)).not.toContain("168");
    expect(hudShape(false, true)).toContain("C228,148 230,168 214,168");
    expect(hudShape(false, true)).not.toContain("28 ");
    expect(hudShape(true, true)).toContain("L214,28 C230,28 228,48 244,48");
    expect(hudShape(true, true)).toContain("L126,168 C110,168 112,148 96,148");
  });
});
