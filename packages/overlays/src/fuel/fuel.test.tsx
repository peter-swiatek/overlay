// Tests may use the sim-core entry for fixtures; overlay code itself must not.
import { emptySimState, type FuelOutputs, type TelemetryFrame } from "@overlay/sim-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverlayInstanceSettings } from "../contract";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { FuelOverlay } from "./FuelOverlay";
import { fuelManifest } from "./manifest";
import {
  emptyFreezeMemory,
  freezeAtLine,
  fuelView,
  type FuelView,
  type FuelViewOptions,
} from "./view";

const OPTS: FuelViewOptions = { safetyMarginLaps: 1, liveUpdates: true };

function outputs(over: Partial<FuelOutputs> = {}): FuelOutputs {
  return {
    fuelLastLap: 2.5,
    fuelAvgLap: 2.5,
    fuelMaxLap: 3,
    lapsRemainingAvg: 16,
    lapsRemainingConservative: 13.33,
    fuelDelta: null,
    plusOneLapTarget: null,
    fuelSavingNeeded: null,
    pitWindow: { start: 14, end: 19, feasible: true },
    tankCapacityL: 60,
    validLapCount: 4,
    fuelAvg5Lap: 2.4,
    fuelAvg10Lap: 2.2,
    recentLaps: [
      { lapNumber: 5, used: 3, lapTimeS: 90 },
      { lapNumber: 4, used: 1.5, lapTimeS: 90 },
      { lapNumber: 3, used: 4, lapTimeS: 90 },
    ],
    lapsToGo: 15,
    stintLaps: 5,
    stintTimeS: 450,
    fuelPerHour: null,
    ...over,
  };
}

function frame(
  fuel: FuelOutputs | null,
  opts: {
    sim?: "iracing" | "lmu";
    energy?: FuelOutputs | null;
    fuelL?: number;
    energy01?: number;
  } = {},
): TelemetryFrame {
  const state = emptySimState("mock");
  state.sim = opts.sim ?? "iracing";
  state.player.fuelL = opts.fuelL ?? 40;
  state.player.energyFraction = opts.energy01 ?? null;
  return {
    seq: 1,
    source: "mock",
    status: "live",
    error: null,
    state,
    derived: {
      fuel,
      energy: opts.energy ?? null,
      track: { trackKey: null, outlineReady: false },
      standings: null,
      proximity: null,
      gaps: [],
    },
  };
}

function view(fuel = outputs(), opts: Parameters<typeof frame>[1] = {}, o = OPTS): FuelView {
  const v = fuelView(frame(fuel, opts), o);
  if (v === null) throw new Error("no view");
  return v;
}

describe("fuelView", () => {
  it("is null without data", () => {
    expect(fuelView(null, OPTS)).toBeNull();
    expect(fuelView(frame(null), OPTS)).toBeNull();
  });

  it("builds the three consumption rows", () => {
    const v = view();
    expect(v.consumption.map((r) => r.label)).toEqual(["LAST", "AVG 5L", "AVG 10L"]);
    expect(v.consumption.map((r) => r.perLap)).toEqual([2.5, 2.4, 2.2]);
    expect(v.consumption[0]).toMatchObject({ laps: 16, stintLaps: 24 });
    // (15 + 1) * 2.5 - 40 = 0
    expect(v.consumption[0]?.refuel).toBe(0);
    // (15 + 1) * 2.2 - 40 < 0 -> 0; AVG 5L: 38.4 - 40 -> 0
    expect(view(outputs(), { fuelL: 10 }).consumption[0]?.refuel).toBe(30);
  });

  it("colours laps left against laps to go plus margin", () => {
    // avg 16 >= 15 + 1, last 16, worst 13.33 < 16
    const v = view();
    expect(v.lapsLeftState).toEqual({ avg: "gain", last: "gain", worst: "loss" });
    const noMargin = view(outputs(), {}, { ...OPTS, safetyMarginLaps: 0 });
    expect(noMargin.lapsLeftState.worst).toBe("loss");
    const tight = view(outputs({ lapsRemainingAvg: 15.5 }), {}, { ...OPTS, safetyMarginLaps: 0 });
    expect(tight.lapsLeftState.avg).toBe("gain");
    expect(view(outputs({ lapsRemainingAvg: 15.5 })).lapsLeftState.avg).toBe("loss");
    expect(view(outputs({ lapsToGo: null })).lapsLeftState).toEqual({
      avg: null,
      last: null,
      worst: null,
    });
    expect(view(outputs({ fuelLastLap: null })).lapsLeft.last).toBeNull();
  });

  it("orders history oldest first and clamps fractions against fuelMaxLap", () => {
    const v = view();
    expect(v.history.map((h) => h.lapNumber)).toEqual([3, 4, 5]);
    expect(v.history.map((h) => h.fraction)).toEqual([1, 0.5, 1]);
    expect(v.maxBasis).toBe(3);
    const none = view(outputs({ fuelMaxLap: null }));
    expect(none.history.every((h) => h.fraction === 0)).toBe(true);
  });

  it("adds the +1 and +2 lap targets", () => {
    // 40 L over floor(16) + 1 and + 2 laps
    expect(view().targets).toEqual([
      { extraLaps: 1, laps: 17, perLap: 2.35 },
      { extraLaps: 2, laps: 18, perLap: 2.22 },
    ]);
    expect(view(outputs({ lapsRemainingAvg: null })).targets).toEqual([]);
  });

  it("caps the refuel at the tank and honours the margin", () => {
    const v = view(outputs({ fuelAvgLap: 4 }), { fuelL: 10 });
    // (15 + 1) * 4 - 10 = 54 <= 60
    expect(v.refuel).toBe(54);
    expect(view(outputs({ fuelAvgLap: 4, tankCapacityL: 50 }), { fuelL: 10 }).refuel).toBe(50);
    expect(
      view(outputs({ fuelAvgLap: 4 }), { fuelL: 10 }, { ...OPTS, safetyMarginLaps: 0 }).refuel,
    ).toBe(50);
  });

  it("passes the pit window through and keeps null before 2 valid laps", () => {
    expect(view().pitWindow).toEqual({ start: 14, end: 19, feasible: true });
    expect(view(outputs({ pitWindow: null, validLapCount: 1 })).pitWindow).toBeNull();
  });

  it("uses LMU energy only in LMU and only when non-null", () => {
    const energy = outputs({ tankCapacityL: 100, fuelLastLap: 5, lapsToGo: 10 });
    const lmu = view(outputs(), { sim: "lmu", energy, energy01: 0.5 });
    expect(lmu.unit).toBe("energy");
    expect(lmu.current).toBe(50);
    expect(lmu.capacity).toBe(100);
    expect(lmu.levelFraction).toBe(0.5);
    expect(view(outputs(), { sim: "iracing", energy, energy01: 0.5 }).unit).toBe("fuel");
    expect(view(outputs(), { sim: "lmu", energy: null }).unit).toBe("fuel");
  });

  it("rounds amounts and laps so unchanged frames compare equal", () => {
    const a = view(outputs({ fuelLastLap: 2.5001 }), { fuelL: 40.0004 });
    const b = view(outputs({ fuelLastLap: 2.5002 }), { fuelL: 40.0003 });
    expect(a).toEqual(b);
  });
});

describe("freezeAtLine", () => {
  const a = view(outputs(), { fuelL: 40 });
  const b = view(outputs({ pitWindow: null, fuelAvg5Lap: 9 }), { fuelL: 30 });

  it("passes through when memory is empty", () => {
    expect(freezeAtLine(a, 3, emptyFreezeMemory())).toBe(a);
    expect(freezeAtLine(null, 3, emptyFreezeMemory())).toBeNull();
  });

  it("holds targets and friends until the lap counter changes", () => {
    const memory = emptyFreezeMemory();
    freezeAtLine(a, 3, memory);
    const held = freezeAtLine(b, 3, memory);
    expect(held?.current).toBe(30);
    expect(held?.targets).toBe(a.targets);
    expect(held?.pitWindow).toBe(a.pitWindow);
    expect(held?.refuel).toBe(a.refuel);
    expect(held?.consumption).toBe(a.consumption);
    expect(held?.lapsLeft).toBe(a.lapsLeft);
    expect(freezeAtLine(b, 4, memory)).toBe(b);
  });

  it("resets when the unit changes", () => {
    const memory = emptyFreezeMemory();
    freezeAtLine(a, 3, memory);
    const energy = view(outputs(), { sim: "lmu", energy: outputs(), energy01: 0.4 });
    expect(freezeAtLine(energy, 3, memory)).toBe(energy);
  });
});

function settingsWith(
  options: Record<string, unknown> = {},
  fields?: string[],
): OverlayInstanceSettings {
  const base = defaultInstanceSettings(fuelManifest);
  if (fields === undefined) return applySettingsPatch(fuelManifest, base, { options });
  const hidden = fuelManifest.fields.map((f) => f.id).filter((id) => !fields.includes(id));
  const config = [
    ...fields.map((id) => ({ id, visible: true, widthPct: null })),
    ...hidden.map((id) => ({ id, visible: false, widthPct: null })),
  ];
  return applySettingsPatch(fuelManifest, base, { options, common: { fields: config } });
}

function render(
  f: TelemetryFrame | null,
  settings = settingsWith(),
  runtime: Partial<OverlayRuntime> = {},
): string {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <FuelOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

describe("FuelOverlay", () => {
  it("renders the default fields in both layouts", () => {
    const vertical = render(frame(outputs()));
    expect(vertical).toContain("fuel--vertical");
    expect(vertical).toContain("AVG 5L");
    expect(vertical).toContain("Laps 14–19");
    expect(vertical).not.toContain('data-field="fuel-history"');
    expect(render(frame(outputs()), settingsWith({ layout: "horizontal" }))).toContain(
      "fuel--horizontal",
    );
  });

  it("shows only visible fields in the configured order", () => {
    const html = render(frame(outputs()), settingsWith({}, ["refuel", "pit-window"]));
    expect(html).toContain('data-field="refuel"');
    expect(html.indexOf('data-field="refuel"')).toBeLessThan(
      html.indexOf('data-field="pit-window"'),
    );
    expect(html).not.toContain('data-field="consumption"');
  });

  it("explains an unreachable pit window and shows -- while null", () => {
    const only = ["pit-window"];
    const bad = outputs({ pitWindow: { start: 20, end: 10, feasible: false } });
    expect(render(frame(bad), settingsWith({}, only))).toContain("not reachable on one stop");
    expect(render(frame(outputs({ pitWindow: null })), settingsWith({}, only))).toContain(">--<");
  });

  it("shows imperial gallons", () => {
    const html = render(frame(outputs()), settingsWith({}, ["fuel-level"]), {
      prefs: { units: "imperial", speedInMph: false, timeFormat: "12h" },
    });
    expect(html).toContain("gal");
    expect(html).not.toContain(" L<");
  });

  it("shows energy in percent, not litres", () => {
    const energy = outputs({ tankCapacityL: 100 });
    const html = render(
      frame(outputs(), { sim: "lmu", energy, energy01: 0.5 }),
      settingsWith({}, ["fuel-level", "refuel"]),
    );
    expect(html).toContain("50.0%");
    expect(html).not.toMatch(/\d (L|gal)</);
  });

  it("waits for a lap, and shows a sample while editing", () => {
    expect(render(null)).toContain("Waiting for a lap");
    expect(render(frame(null))).toContain("Waiting for a lap");
    const sample = render(null, settingsWith(), { editing: true });
    expect(sample).not.toContain("Waiting for a lap");
    expect(sample).toContain("AVG 10L");
  });
});

describe("selector timing", () => {
  it("stays far below the 5 Hz budget", () => {
    const f = frame(outputs());
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      fuelView(f, OPTS);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const median = times[100] ?? 0;
    console.log(`fuelView median ${median.toFixed(4)} ms`);
    expect(median).toBeLessThan(2);
  });
});
