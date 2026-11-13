import type { FuelOutputs, TelemetryFrame } from "@overlay/sim-core/types";
import { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from "@overlay/ui/types";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { METRICS, metricAvailable, metricById } from "./metrics";
import {
  biasChangeText,
  dataFramesView,
  fuelShortL,
  newBiasMemory,
  sampleTiles,
  tileView,
  trackBiasBase,
  type TileContext,
} from "./view";

const CTX: TileContext = { prefs: DEFAULT_DISPLAY_PREFS, livePositions: true, biasBase: null };
const IMPERIAL: DisplayPrefs = { ...DEFAULT_DISPLAY_PREFS, units: "imperial" };

function fuel(partial: Partial<FuelOutputs>): FuelOutputs {
  return {
    fuelLastLap: null,
    fuelAvgLap: null,
    fuelMaxLap: null,
    lapsRemainingAvg: null,
    lapsRemainingConservative: null,
    fuelDelta: null,
    plusOneLapTarget: null,
    fuelSavingNeeded: null,
    pitWindow: null,
    tankCapacityL: null,
    validLapCount: 0,
    fuelAvg5Lap: null,
    fuelAvg10Lap: null,
    recentLaps: [],
    lapsToGo: null,
    stintLaps: 0,
    stintTimeS: null,
    fuelPerHour: null,
    ...partial,
  };
}

/** The board's situation: P3 of 16 GT3s (plus a GTP), 54.2 % bias, 47 L with 19.6 L short. */
function frame(sim: "iracing" | "lmu" = "iracing"): TelemetryFrame {
  const gt3 = Array.from({ length: 16 }, (_, i) => ({
    carIdx: i,
    classId: "gt3",
    className: "GT3",
    classColour: "#ffda59",
    classPosition: i + 1,
    position: i + 2,
  }));
  const f = fixtureFrame({
    sim,
    playerCarIdx: 2,
    cars: [
      ...gt3.map((c) => (c.carIdx === 2 ? { ...c, lapInProgress: 12, inPitStall: false } : c)),
      { carIdx: 20, classId: "gtp", className: "GTP", classPosition: 1, position: 1 },
      { carIdx: 21, isPaceCar: true },
    ],
    session: {
      type: "race",
      typeName: "RACE",
      lapsTotal: 30,
      lapsRemaining: 18,
      timeRemainingS: null,
      incidentLimit: 17,
    },
    conditions: { trackTempC: 31, airTempC: 22.4 },
    player: {
      brakeBias: 0.542,
      fuelL: 47,
      speedMps: 58.9,
      gear: 4,
      rpm: 7450.4,
      incidentCount: 4,
      energyFraction: 0.624,
      isOnTrack: true,
      lap: { currentLapS: 30, lastLapS: 100.15, bestLapS: 99.838, delta: null },
    },
  });
  // 18 laps to go at 3.7 L a lap need 66.6 L: 19.6 L more than the 47 L in the tank.
  f.derived.fuel = fuel({ lapsToGo: 18, fuelAvgLap: 3.7, lapsRemainingAvg: 12.7027 });
  return f;
}

const tile = (id: string, f: TelemetryFrame | null = frame(), ctx: TileContext = CTX) => {
  const t = tileView(id, f, ctx);
  if (t === null) throw new Error(`no tile ${id}`);
  return t;
};

describe("metric catalogue", () => {
  it("has unique ids and limits incidents to iRacing and virtual energy to LMU", () => {
    const ids = METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const limited = METRICS.filter((m) => "sims" in m).map((m) => [m.id, m.sims]);
    expect(limited).toEqual([
      ["energy", ["lmu"]],
      ["incidents", ["iracing"]],
    ]);
    const incidents = metricById("incidents");
    if (incidents === undefined) throw new Error("catalogue");
    expect(metricAvailable(incidents, "lmu")).toBe(false);
    expect(metricAvailable(incidents, "iracing")).toBe(true);
    expect(metricAvailable(incidents, null)).toBe(true);
  });

  it("gives null for an unknown metric and skips it in the view", () => {
    expect(tileView("nope", frame(), CTX)).toBeNull();
    expect(dataFramesView(["nope", "lap"], frame(), CTX).map((t) => t.metric)).toEqual(["lap"]);
  });

  it("shows '--' for every metric without a live frame", () => {
    const stale = { ...frame(), status: "waiting" as const };
    for (const m of METRICS) {
      for (const f of [null, stale]) {
        expect(tile(m.id, f)).toMatchObject({ label: m.label, value: "--", secondary: null });
      }
    }
  });

  it("shows '--' for a metric the sim lacks, even with data in the frame", () => {
    expect(tile("incidents", frame("lmu")).value).toBe("--");
    expect(tile("energy", frame("iracing")).value).toBe("--");
    expect(tile("energy", frame("lmu")).value).toBe("62.4%");
  });
});

describe("tiles", () => {
  it("class position: the chip in the class colour, then the class field and name", () => {
    expect(tile("class-position")).toMatchObject({
      label: "Class Pos",
      value: "P3",
      chip: true,
      classColour: "#ffda59",
      secondary: "of 16 GT3",
    });
  });

  it("overall position counts every car but the pace car", () => {
    expect(tile("position")).toMatchObject({ value: "P4", chip: true, secondary: "of 17" });
  });

  it("brake bias: one decimal in the accent, the change since the stint start", () => {
    expect(tile("brake-bias")).toMatchObject({
      value: "54.2%",
      valueTone: "accent",
      secondary: null,
    });
    expect(tile("brake-bias", frame(), { ...CTX, biasBase: 0.54 }).secondary).toBe("+0.2%");
    expect(tile("brake-bias", frame(), { ...CTX, biasBase: 0.545 }).secondary).toBe("-0.3%");
  });

  it("fuel level: litres, and the fuel still needed to finish in loss red", () => {
    expect(tile("fuel-level")).toMatchObject({
      value: "47.0 L",
      secondary: "19.6L",
      secondaryTone: "loss",
    });
    expect(tile("fuel-level", frame(), { ...CTX, prefs: IMPERIAL }).value).toBe("12.4 gal");
  });

  it("fuel level hides the shortfall when the tank is enough or it is unknown", () => {
    const enough = frame();
    enough.derived.fuel = fuel({ lapsToGo: 10, fuelAvgLap: 3.7 });
    expect(tile("fuel-level", enough)).toMatchObject({ secondary: null, secondaryTone: null });
    const unknown = frame();
    unknown.derived.fuel = null;
    expect(tile("fuel-level", unknown)).toMatchObject({ value: "47.0 L", secondary: null });
  });

  it("fuel laps: laps left on the average and the average per lap", () => {
    expect(tile("fuel-laps")).toMatchObject({ value: "12.7", secondary: "3.70 L/lap" });
  });

  it("temperatures: one decimal, the other one rounded, in the user's units", () => {
    expect(tile("track-temp")).toMatchObject({ value: "31.0°", secondary: "Air 22°" });
    expect(tile("air-temp")).toMatchObject({ value: "22.4°", secondary: "Track 31°" });
    expect(tile("track-temp", frame(), { ...CTX, prefs: IMPERIAL })).toMatchObject({
      value: "87.8°",
      secondary: "Air 72°",
    });
  });

  it("lap times with 3 decimals; the last lap against the best", () => {
    expect(tile("last-lap")).toMatchObject({ value: "1:40.150", secondary: "+0.312" });
    expect(tile("best-lap")).toMatchObject({ value: "1:39.838", secondary: null });
  });

  it("lap and remaining: laps in a lap race, time in a timed one", () => {
    expect(tile("lap")).toMatchObject({ value: "12", secondary: "of 30" });
    expect(tile("remaining")).toMatchObject({ value: "18", secondary: "laps" });
    const timed = frame();
    timed.state.session.timeRemainingS = 2530.6;
    timed.state.session.lapsRemaining = null;
    timed.state.session.lapsTotal = null;
    expect(tile("remaining", timed)).toMatchObject({ value: "42:10", secondary: null });
    expect(tile("lap", timed)).toMatchObject({ value: "12", secondary: null });
  });

  it("delta: the auto reference, gain or loss coloured", () => {
    const f = frame();
    f.derived.delta = {
      autoKind: "sessionBest",
      live: { sessionBest: { deltaS: -0.214, rate: null, speedDeltaMps: null, source: "sim" } },
    } as unknown as TelemetryFrame["derived"]["delta"];
    expect(tile("delta", f)).toMatchObject({
      value: "-0.21",
      valueTone: "gain",
      secondary: "vs Session",
    });
    expect(tile("delta").value).toBe("--");
  });

  it("speed, gear and incidents", () => {
    expect(tile("speed")).toMatchObject({ value: "212", secondary: "km/h" });
    expect(tile("gear")).toMatchObject({ value: "4", secondary: "7450 rpm" });
    const neutral = frame();
    neutral.state.player.gear = 0;
    expect(tile("gear", neutral).value).toBe("N");
    neutral.state.player.gear = -1;
    expect(tile("gear", neutral).value).toBe("R");
    expect(tile("incidents")).toMatchObject({ value: "4x", secondary: "of 17x" });
  });

  it("never colours a value by closeness to another car", () => {
    for (const m of METRICS) {
      const t = tile(m.id);
      expect(JSON.stringify(t)).not.toContain("threat");
    }
  });
});

describe("fuelShortL", () => {
  it("is the refuel formula with no margin and no tank cap", () => {
    expect(fuelShortL(frame())).toBeCloseTo(19.6, 9);
    const long = frame();
    long.derived.fuel = fuel({ lapsToGo: 60, fuelAvgLap: 3.7, tankCapacityL: 100 });
    expect(fuelShortL(long)).toBeCloseTo(175, 9);
  });
});

describe("brake bias base", () => {
  it("is the value when the session starts, and follows it in the pit stall", () => {
    const memory = newBiasMemory();
    const f = frame();
    f.state.player.brakeBias = 0.54;
    expect(trackBiasBase(f, memory)).toBe(0.54);
    f.state.player.brakeBias = 0.542;
    expect(trackBiasBase(f, memory)).toBe(0.54);
    expect(trackBiasBase(null, memory)).toBe(0.54);
    const stall = frame();
    const own = stall.state.cars.find((c) => c.carIdx === 2);
    if (own === undefined) throw new Error("fixture");
    own.inPitStall = true;
    stall.state.player.brakeBias = 0.55;
    expect(trackBiasBase(stall, memory)).toBe(0.55);
    expect(trackBiasBase(frame(), memory)).toBe(0.55);
  });

  it("follows the value in the garage and restarts with a new session", () => {
    const memory = newBiasMemory();
    expect(trackBiasBase(frame(), memory)).toBe(0.542);
    const garage = frame();
    garage.state.player.isOnTrack = false;
    garage.state.player.brakeBias = 0.53;
    expect(trackBiasBase(garage, memory)).toBe(0.53);
    const next = frame();
    next.state.session.typeName = "QUALIFY";
    next.state.player.brakeBias = 0.56;
    expect(trackBiasBase(next, memory)).toBe(0.56);
  });

  it("prints the change in percentage points, hidden when unchanged", () => {
    expect(biasChangeText(0.542, 0.54)).toBe("+0.2%");
    expect(biasChangeText(0.537, 0.54)).toBe("-0.3%");
    expect(biasChangeText(0.5402, 0.54)).toBeNull();
    expect(biasChangeText(null, 0.54)).toBeNull();
    expect(biasChangeText(0.54, null)).toBeNull();
  });
});

describe("sampleTiles", () => {
  it("is the design board's four tiles by default", () => {
    const tiles = sampleTiles(["class-position", "brake-bias", "fuel-level", "track-temp"]);
    expect(tiles.map((t) => [t.label, t.value, t.secondary])).toEqual([
      ["Class Pos", "P3", "of 16 GT3"],
      ["Brake Bias", "54.2%", "+0.2%"],
      ["Fuel Level", "47.0 L", "19.6L"],
      ["Track Temp", "31.0°", "Air 22°"],
    ]);
    expect(tiles[0]?.chip).toBe(true);
    expect(tiles[1]?.valueTone).toBe("accent");
    expect(tiles[2]?.secondaryTone).toBe("loss");
  });

  it("has a sample for every metric, lap times with 3 decimals", () => {
    const tiles = sampleTiles(METRICS.map((m) => m.id));
    expect(tiles).toHaveLength(METRICS.length);
    for (const t of tiles) expect(t.value).not.toBe("--");
    expect(tiles.find((t) => t.metric === "best-lap")?.value).toMatch(/\.\d{3}$/);
  });
});
