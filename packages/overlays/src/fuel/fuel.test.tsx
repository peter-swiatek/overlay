import { readFileSync } from "node:fs";
import { join } from "node:path";
// Tests may use the sim-core entry for fixtures; overlay code itself must not.
import { emptyCar, emptySimState, type FuelOutputs, type TelemetryFrame } from "@overlay/sim-core";
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
      track: {
        trackKey: null,
        outlineReady: false,
        pitExitLapDistPct: null,
        pitExitDistanceM: null,
      },
      standings: null,
      proximity: null,
      delta: null,
      slowCar: null,
      laps: null,
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
    // Covers lapsToGo (15) but not lapsToGo + margin (16): warn.
    expect(view(outputs({ lapsRemainingAvg: 15.5 })).lapsLeftState.avg).toBe("warn");
    expect(view(outputs({ lapsRemainingAvg: 16 })).lapsLeftState.avg).toBe("gain");
    expect(view(outputs({ lapsRemainingAvg: 14.9 })).lapsLeftState.avg).toBe("loss");
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

  it("adds the +0, +1 and +2 lap targets", () => {
    // 40 L over floor(16) + 0, 1 and 2 laps
    expect(view().targets).toEqual([
      { extraLaps: 0, laps: 16, perLap: 2.5 },
      { extraLaps: 1, laps: 17, perLap: 2.35 },
      { extraLaps: 2, laps: 18, perLap: 2.22 },
    ]);
    expect(view(outputs({ lapsRemainingAvg: null })).targets).toEqual([]);
  });

  it("reports the session time left and the player's lap", () => {
    const f = frame(outputs());
    f.state.session.timeRemainingS = 1474.6;
    f.state.playerCarIdx = 3;
    f.state.cars = [{ ...emptyCar(3), lapInProgress: 15 }];
    const v = fuelView(f, OPTS);
    expect(v?.timeRemainingS).toBe(1475);
    expect(v?.currentLap).toBe(15);
    expect(view().timeRemainingS).toBeNull();
    expect(view().currentLap).toBeNull();
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
    const vertical = render(frame(outputs(), { fuelL: 30 }));
    expect(vertical).toContain("fuel--vertical");
    expect(vertical).toContain("AVG 5L");
    expect(vertical).toContain("Lap 14–19");
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
    expect(render(frame(bad, { fuelL: 30 }), settingsWith({}, only))).toContain(
      "not reachable on one stop",
    );
    expect(render(frame(outputs({ pitWindow: null })), settingsWith({}, only))).toContain(">--<");
  });

  it("says no stop is needed when the refuel is zero", () => {
    // Default 40 L covers the 15 laps to go: refuel 0.
    const html = render(frame(outputs()), settingsWith({}, ["pit-window"]));
    expect(html).toContain("No stop needed");
    expect(html).not.toContain("Lap 14");
  });

  it("scales history bars against the largest lap shown", () => {
    const html = render(frame(outputs()), settingsWith({}, ["fuel-history"]));
    expect(html).toContain("height:100%");
    expect(html).toContain("height:38%");
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

describe("manifest", () => {
  it("sizes the window per layout option, starting at the default", () => {
    const by = fuelManifest.sizeByOption;
    expect(by?.key).toBe("layout");
    const layout = fuelManifest.settings.find((x) => x.key === "layout");
    expect(layout?.default).toBe("vertical");
    expect(by?.sizes[String(layout?.default)]).toEqual(fuelManifest.defaultSize);
    expect(by?.sizes.horizontal).toEqual({ width: 480, height: 216 });
    expect(fuelManifest.defaultSize).toEqual({ width: 250, height: 360 });
  });

  it("orders the fields as the board and keeps usage and history off", () => {
    expect(fuelManifest.fields.map((f) => f.id)).toEqual([
      "fuel-level",
      "laps-remaining",
      "consumption",
      "refuel",
      "targets",
      "laps-left",
      "pit-window",
      "usage",
      "fuel-history",
    ]);
    const defaults = defaultInstanceSettings(fuelManifest).common.fields;
    expect(defaults.filter((f) => !f.visible).map((f) => f.id)).toEqual(["usage", "fuel-history"]);
  });
});

describe("FuelOverlay layouts", () => {
  const BLOCKS: [string, string][] = [
    ["fuel-level", 'data-field="fuel-level"'],
    ["laps-remaining", 'data-field="laps-remaining"'],
    ["consumption", 'data-field="consumption"'],
    ["targets", 'data-field="targets"'],
    ["laps-left", 'data-field="laps-left"'],
    ["pit-window", 'data-field="pit-window"'],
    ["usage", 'data-field="usage"'],
    ["fuel-history", 'data-field="fuel-history"'],
  ];

  for (const layout of ["vertical", "horizontal"]) {
    for (const [field, marker] of BLOCKS) {
      it(`${layout}: ${field} toggles its block`, () => {
        const f = frame(outputs(), { fuelL: 30 });
        expect(render(f, settingsWith({ layout }, [field]))).toContain(marker);
        const others = BLOCKS.map(([id]) => id).filter((id) => id !== field);
        expect(render(f, settingsWith({ layout }, others))).not.toContain(marker);
      });
    }
  }

  it("keeps the vertical blocks in the user's order", () => {
    const html = render(frame(outputs()), settingsWith({}, ["targets", "consumption"]));
    expect(html.indexOf('data-field="targets"')).toBeLessThan(
      html.indexOf('data-field="consumption"'),
    );
  });

  it("uses the fixed horizontal grid whatever the order", () => {
    const html = render(
      frame(outputs()),
      settingsWith({ layout: "horizontal" }, ["targets", "pit-window", "laps-left", "consumption"]),
    );
    const at = (id: string): number => html.indexOf(`data-field="${id}"`);
    expect(html).toContain("fuel-split");
    expect(at("consumption")).toBeLessThan(at("laps-left"));
    expect(at("laps-left")).toBeLessThan(at("pit-window"));
    expect(at("pit-window")).toBeLessThan(at("targets"));
    expect(html).toContain(">PIT<");
    expect(html).not.toContain("fuel-split--single");
    const single = render(frame(outputs()), settingsWith({ layout: "horizontal" }, ["laps-left"]));
    expect(single).toContain("fuel-split--single");
  });

  it("shows three targets", () => {
    const html = render(frame(outputs(), { fuelL: 30 }), settingsWith({}, ["targets"]));
    expect(html.match(/fuel-target-cell/g)).toHaveLength(3);
    expect(html).toContain("16 laps");
    expect(html).toContain("18 laps");
  });

  it("shows the session time left and the lap", () => {
    const f = frame(outputs());
    f.state.session.timeRemainingS = 1475;
    f.state.playerCarIdx = 0;
    f.state.cars = [{ ...emptyCar(0), lapInProgress: 15 }];
    expect(render(f, settingsWith({}, ["laps-left"]))).toContain("<b>24:35</b>");
    expect(render(f, settingsWith({}, ["fuel-level"]))).toContain("Lap 15");
    expect(render(f, settingsWith({ layout: "horizontal" }, ["fuel-level"]))).toContain("Lap 15");
  });

  it("tints the laps left cards by tone", () => {
    // avg 16 and last 16 cover 15 + 1; worst 13.33 is short.
    const html = render(frame(outputs()), settingsWith({}, ["laps-left"]));
    expect(html).toContain("fuel-rem-cell--gain");
    expect(html).toContain("fuel-rem-cell--loss");
    const warn = render(
      frame(outputs({ lapsRemainingAvg: 15.5 })),
      settingsWith({}, ["laps-left"]),
    );
    expect(warn).toContain("fuel-rem-cell--warn");
  });

  it("shows a refuel banner without the consumption table, and a pill column with it", () => {
    const banner = render(frame(outputs()), settingsWith({}, ["refuel"]));
    expect(banner).toContain("fuel-banner");
    expect(banner).not.toContain("fuel-refuel-pill");
    const pills = render(frame(outputs()), settingsWith({}, ["consumption", "refuel"]));
    expect(pills).toContain("fuel-refuel-pill");
    expect(pills).toContain("REFUEL");
    expect(pills).not.toContain("fuel-banner");
    const noColumn = render(frame(outputs()), settingsWith({}, ["consumption"]));
    expect(noColumn).not.toContain("REFUEL");
    expect(noColumn).toContain("fuel-cons--no-refuel");
    const horizontal = render(frame(outputs()), settingsWith({ layout: "horizontal" }, ["refuel"]));
    expect(horizontal).toContain("fuel-banner");
  });

  it("folds laps remaining into the tank card in the vertical layout", () => {
    const html = render(frame(outputs()), settingsWith({}, ["fuel-level", "laps-remaining"]));
    expect(html).toContain("Laps in race");
    expect(html.match(/fuel-tank-card/g)).toHaveLength(1);
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

describe("fuel gauge well CSS", () => {
  const css = readFileSync(join(__dirname, "fuel.css"), "utf8");
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("keeps the vertical well 36 px tall with 4 px padding instead of flexing in the column", () => {
    const well = rule(".fuel-gauge-well");
    expect(well).toContain("flex: none;");
    expect(well).toContain("height: 2.57em;");
    expect(well).toContain("padding: 0.29em;");
  });

  it("lets the horizontal well fill the row at 34 px", () => {
    const row = rule(".fuel-tank-card--row .fuel-gauge-well");
    expect(row).toContain("flex: 1;");
    expect(row).toContain("height: 2.43em;");
  });

  it("flattens the vertical laps-remaining block so its header sits midway between targets and cards", () => {
    expect(css).toContain(
      ".fuel--vertical .fuel-slot:has(> .fuel-rem),\n.fuel--vertical .fuel-rem {\n  display: contents;",
    );
  });
});

describe("Fuel table units", () => {
  it("shows plain numbers in the table, refuel pills and targets, the unit only on the tank", () => {
    const html = render(frame(outputs(), { fuelL: 30 }));
    const pills = html.match(/class="fuel-refuel-pill">([^<]*)</g) ?? [];
    expect(pills.length).toBeGreaterThan(0);
    for (const p of pills) expect(p).not.toMatch(/ L</);
    const targets = html.match(/class="fuel-target-val">([^<]*)</g) ?? [];
    for (const t of targets) expect(t).not.toMatch(/ L</);
    expect(html).toMatch(/30\.00 L/);
  });
});
