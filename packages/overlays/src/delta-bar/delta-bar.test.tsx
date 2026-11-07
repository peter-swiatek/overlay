import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { DeltaBarOverlay } from "./DeltaBarOverlay";
import { deltaBarManifest } from "./manifest";
import type { SectorState, SectorTiming } from "@overlay/sim-core/types";
import { deltaOutputs, liveFrame } from "./test-support";

function render(
  frame: TelemetryFrame | null,
  opts: {
    options?: Record<string, boolean | number | string>;
    runtime?: Partial<OverlayRuntime>;
  } = {},
): string {
  const settings = defaultInstanceSettings(deltaBarManifest);
  Object.assign(settings.options, opts.options ?? {});
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(frame, opts.runtime)}>
      <DeltaBarOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const completion = {
  lapNumber: 4,
  lapTimeS: 99.5,
  clean: true,
  references: { sessionBestClean: 99.8 },
  autoKind: "sessionBestClean" as const,
  completedAtS: 90,
};

function raceFrame(): TelemetryFrame {
  const f = fixtureFrame({
    playerCarIdx: 1,
    session: { type: "race" },
    player: { speedMps: 40, trackSurface: "onTrack" },
    cars: [
      { carIdx: 1, classId: "A", carNumber: "7", lastLapS: 100, driverName: "Me Driver" },
      {
        carIdx: 2,
        classId: "A",
        carNumber: "8",
        lastLapS: 99.6,
        driverName: "Ann Ahead",
        classColour: "#ff0000",
      },
    ],
    standings: [
      { carIdx: 1, liveClassPosition: 2, lineInterval: { laps: 0, seconds: 1.3 } },
      { carIdx: 2, liveClassPosition: 1 },
    ],
  });
  f.derived.delta = deltaOutputs();
  return f;
}

describe("DeltaBarOverlay markup", () => {
  it("renders the tiles for a live frame", () => {
    const html = render(liveFrame(deltaOutputs()));
    expect(html).toContain("dl-bt");
    expect(html).toContain("All-time Best");
    expect(html).toContain("Session Best");
    expect(html).toContain("1:39.40");
    expect(html).toContain("-0.42");
    expect(html).toContain("dl-trend");
    expect(html).toContain("<b>+4</b>");
    expect(html).toContain("km/h");
    expect(html).toContain("-2.0");
    expect(html).toContain("+2.0");
    expect(html).toContain("Pred");
    expect(html).toContain("1:39.38");
    expect(html).toContain("1:40.06");
    expect(html).toContain("1:39.10");
    expect(html).toContain("Live delta vs Session best 1:39.80");
    expect(html).not.toContain("dl-lap");
    expect(html).not.toContain("dl-h2h");
  });

  it("renders nothing when hidden and not editing", () => {
    expect(render(null)).toBe("");
    expect(render(liveFrame(deltaOutputs(), { surface: "offTrack" }))).toBe("");
    expect(render(liveFrame(deltaOutputs(), { speedKmh: 20 }))).toBe("");
  });

  it("shows the edit sample while editing and hidden", () => {
    const html = render(null, { runtime: { editing: true } });
    expect(html).toContain("-0.42");
    expect(html).toContain("1:39.40");
    expect(html).toContain("1:39.12");
    expect(html).toContain("dl-h2h");
    expect(html).toContain("A. Sample");
  });

  it("collapses the grid per toggle", () => {
    const all = render(liveFrame(deltaOutputs()));
    expect(all).toContain("grid-template-columns:minmax(0, 1fr) 118px 118px");
    const noSpeed = render(liveFrame(deltaOutputs()), { options: { "show-delta-speed": false } });
    expect(noSpeed).toContain('grid-template-columns:minmax(0, 1fr) 118px"');
    expect(noSpeed).not.toContain("dl-spd");
    const noBest = render(liveFrame(deltaOutputs()), { options: { "show-best-times": false } });
    expect(noBest).toContain("grid-template-columns:minmax(0, 1fr) 118px");
    expect(noBest).not.toContain("dl-bt");
    const neither = render(liveFrame(deltaOutputs()), {
      options: { "show-best-times": false, "show-delta-speed": false },
    });
    expect(neither).toContain('grid-template-columns:minmax(0, 1fr)"');
  });

  it("keeps the speed tile flat at zero", () => {
    const d = deltaOutputs();
    d.live.sessionBestClean = { deltaS: 0.1, rate: 0, speedDeltaMps: 0.1, source: "sim" };
    const html = render(liveFrame(d));
    expect(html).toContain("dl-spd--flat");
    expect(html).not.toContain("dl-spd--gain");
    expect(html).not.toContain("dl-spd--loss");
    const fast = render(liveFrame(deltaOutputs()));
    expect(fast).toContain("dl-spd--gain");
    const d2 = deltaOutputs();
    d2.live.sessionBestClean = { deltaS: 0.1, rate: 0, speedDeltaMps: -3, source: "sim" };
    expect(render(liveFrame(d2))).toContain("dl-spd--loss");
  });

  it("draws the trend arrow by rate", () => {
    const falling = render(liveFrame(deltaOutputs()));
    expect(falling).toContain("rotate(180deg)");
    const d = deltaOutputs();
    d.live.sessionBestClean = { deltaS: 0.5, rate: 0.4, speedDeltaMps: null, source: "sim" };
    const rising = render(liveFrame(d));
    expect(rising).toContain("rotate(0deg)");
    expect(rising).toContain("dl-loss");
    d.live.sessionBestClean = { deltaS: 0.5, rate: 0, speedDeltaMps: null, source: "sim" };
    expect(render(liveFrame(d))).not.toContain("dl-trend");
  });

  it("shows -- values without a delta", () => {
    const d = deltaOutputs({
      references: {},
      live: {},
      autoKind: null,
      lastLapS: null,
      optimalLapS: null,
    });
    const html = render(liveFrame(d));
    expect(html).toContain(">--<");
    expect(html).toContain("--:--.---");
    expect(html).toContain('Live delta"');
  });

  it("blanks the best deltas on a closing lap and marks a best set by the last lap", () => {
    const d = deltaOutputs();
    expect(render(liveFrame(d))).toContain("+0.66");
    expect(render(liveFrame(deltaOutputs({ closingLap: true })))).not.toContain("+0.66");
    d.sessionBest = { lapTimeS: 99.3, lastLapDeltaS: -0.5, setByLastLap: true };
    expect(render(liveFrame(d))).toContain("t dl-fastest");
  });

  it("draws the lap-complete strip with chips", () => {
    const d = deltaOutputs({ lastCompletion: completion, lapCompleteVisible: true });
    const html = render(liveFrame(d));
    expect(html).toContain("dl-lap");
    expect(html).toContain("BEST");
    expect(html).toContain("best dl-blink");
    expect(html).toContain("1:39.50");
    expect(html).toContain("dl-fill-gain");
    expect(html).toContain("-0.30");
  });

  it("does not blink BEST with reduced effects, and omits BEST when not beaten", () => {
    const d = deltaOutputs({ lastCompletion: completion, lapCompleteVisible: true });
    const reduced = render(liveFrame(d), { runtime: { reduceVisualEffects: true } });
    expect(reduced).toContain("BEST");
    expect(reduced).not.toContain("dl-blink");
    const slower = deltaOutputs({
      lastCompletion: { ...completion, lapTimeS: 100.3 },
      lapCompleteVisible: true,
    });
    const html = render(liveFrame(slower));
    expect(html).not.toContain("BEST");
    expect(html).toContain("dl-fill-loss");
    expect(html).toContain("+0.50");
  });

  it("draws the head-to-head row in a race and honours the toggle", () => {
    const html = render(raceFrame());
    expect(html).toContain("dl-h2h");
    expect(html).toContain("A. Ahead");
    expect(html).toContain('<span class="ov-car-num">8</span>');
    expect(html).not.toMatch(/class="pos"/);
    expect(html).toContain("-1.3");
    expect(html).toContain("--class-color:#ff0000");
    // an empty tile keeps the second slot
    expect(html).toContain("dl-h2h-empty");
    expect(render(raceFrame(), { options: { "show-head-to-head": false } })).not.toContain(
      "dl-h2h",
    );
  });

  it("scales the bar labels and fill with the range", () => {
    const html = render(liveFrame(deltaOutputs()), { options: { "bar-range": "5" } });
    expect(html).toContain("-5.0");
    expect(html).toContain("+5.0");
    expect(html).toContain("fill-gain");
    // 0.42 / 5 of half the bar
    expect(html).toContain("width:4.2%");
  });
});

/** Sector timing with the same deltas and states for every reference. */
function sectorTiming(
  startPcts: number[],
  deltas: (number | null)[],
  states: (SectorState | null)[],
  current: number | null,
  lapDistPct: number | null,
): SectorTiming {
  const ref = { deltas, states };
  return {
    startPcts,
    current,
    lapDistPct,
    times: deltas.map((d) => (d === null ? null : 30 + d)),
    byReference: { allTimeBest: ref, sessionBestClean: ref, sessionBest: ref, lastLap: ref },
  };
}

const SECTORS = { "bar-style": "sectors" };
const segments = (html: string): string[] => html.match(/<div class="dl-sec[ "][^>]*>/g) ?? [];

describe("DeltaBarOverlay sector bar", () => {
  const four = sectorTiming(
    [0, 0.27, 0.53, 0.78],
    [-0.21, -0.08, 0.12, null],
    ["best", "gain", "loss", null],
    3,
    0.89,
  );

  it("replaces the delta bar with one segment per sector, sized by length", () => {
    const html = render(liveFrame(deltaOutputs({ sectors: four })), { options: SECTORS });
    expect(html).not.toContain("dl-barline");
    expect(html).toContain("dl-sectors");
    const segs = segments(html);
    expect(segs).toHaveLength(4);
    expect(segs.map((x) => /flex-grow:([\d.]+)/.exec(x)?.[1])).toEqual([
      "0.27",
      "0.26",
      "0.25",
      "0.22",
    ]);
    // Pred / Last / Optimal stay below
    expect(html).toContain("Pred");
    expect(html).toContain("Optimal");
  });

  it("colours done sectors by state and marks the car in the current one", () => {
    const html = render(liveFrame(deltaOutputs({ sectors: four })), { options: SECTORS });
    const segs = segments(html);
    expect(segs[0]).toContain("dl-sec dl-sec--best");
    expect(segs[1]).toContain("dl-sec dl-sec--gain");
    expect(segs[2]).toContain("dl-sec dl-sec--loss");
    expect(segs[3]).toContain('class="dl-sec is-current"');
    expect(html).toContain("<span>-0.21</span>");
    expect(html).toContain("<span>-0.08</span>");
    expect(html).toContain("<span>+0.12</span>");
    // (0.89 - 0.78) / 0.22 of the last sector
    expect(html).toContain('class="dl-sec-mark" style="left:50%"');
    expect(html.match(/dl-sec-mark/g)).toHaveLength(1);
  });

  it("uses the deltas of the chosen reference", () => {
    const t = structuredClone(four);
    t.byReference.lastLap = {
      deltas: [0.4, 0.3, 0.2, null],
      states: ["loss", "loss", "loss", null],
    };
    const html = render(liveFrame(deltaOutputs({ sectors: t })), {
      options: { ...SECTORS, reference: "lastLap" },
    });
    expect(html).toContain("<span>+0.40</span>");
    expect(segments(html)[0]).toContain("dl-sec--loss");
  });

  it("falls back to the delta bar without sector data, and keeps it when the style is delta", () => {
    const none = render(liveFrame(deltaOutputs({ sectors: null })), { options: SECTORS });
    expect(none).toContain("dl-barline");
    expect(none).not.toContain("dl-sectors");
    const delta = render(liveFrame(deltaOutputs({ sectors: four })));
    expect(delta).toContain("dl-barline");
    expect(delta).not.toContain("dl-sectors");
  });

  it("draws twelve sectors and prints deltas only in the wide ones", () => {
    const starts = [0, 0.04, 0.12, 0.2, 0.3, 0.36, 0.45, 0.55, 0.62, 0.7, 0.8, 0.9];
    const deltas = starts.map((_, i) => (i < 11 ? 0.05 * (i % 2 === 0 ? 1 : -1) : null));
    const states = deltas.map((d): SectorState | null =>
      d === null ? null : d < 0 ? "gain" : "loss",
    );
    const t = sectorTiming(starts, deltas, states, 11, 0.95);
    const html = render(liveFrame(deltaOutputs({ sectors: t })), { options: SECTORS });
    const segs = segments(html);
    expect(segs).toHaveLength(12);
    expect(segs[0]).toContain("flex-grow:0.04");
    expect(segs[11]).toContain("flex-grow:0.1");
    // 0.04 and 0.06 are too narrow for text; the other nine done sectors print theirs
    expect(html.match(/<span>[+-]0\.05<\/span>/g)).toHaveLength(9);
  });

  it("previews sample sectors while editing", () => {
    const html = render(null, { runtime: { editing: true }, options: SECTORS });
    expect(segments(html)).toHaveLength(4);
    expect(html).toContain("dl-sec--best");
  });

  it("keeps the lap-complete strip over the sector row", () => {
    const d = deltaOutputs({ sectors: four, lastCompletion: completion, lapCompleteVisible: true });
    const html = render(liveFrame(d), { options: SECTORS });
    expect(html).toContain("dl-sectors");
    expect(html).toContain("dl-lap");
  });
});

describe("Delta Bar CSS", () => {
  it("gives the sector row the bar line's height and the locked state colours", () => {
    const css = readFileSync(join(__dirname, "delta-bar.css"), "utf8");
    const rule = (sel: string) => {
      const start = css.indexOf(`${sel} {`);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".dl-sectors")).toContain("font-size: 0.7em;");
    expect(rule(".dl-sectors")).toContain("height: 1lh;");
    expect(rule(".dl-sectors")).toContain("gap: 2px;");
    expect(rule(".dl-sec--best")).toContain("var(--ov-locked-fastest)");
    expect(rule(".dl-sec--gain")).toContain("var(--ov-locked-gain)");
    expect(rule(".dl-sec--loss")).toContain("var(--ov-locked-loss)");
  });

  it("sizes its text from the theme font size so the tiles match the 480 x 108 design", () => {
    const css = readFileSync(join(__dirname, "delta-bar.css"), "utf8");
    const start = css.indexOf(".dl {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("font-size: var(--ov-font-size, 14px);");
  });
});
