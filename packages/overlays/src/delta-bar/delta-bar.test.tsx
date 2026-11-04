import type { TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { DeltaBarOverlay } from "./DeltaBarOverlay";
import { deltaBarManifest } from "./manifest";
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
      { carIdx: 1, liveClassPosition: 2, interval: { laps: 0, seconds: 1.3 } },
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
    expect(all).toContain("grid-template-columns:212px minmax(0, 1fr) 142px");
    const noSpeed = render(liveFrame(deltaOutputs()), { options: { "show-delta-speed": false } });
    expect(noSpeed).toContain('grid-template-columns:212px minmax(0, 1fr)"');
    expect(noSpeed).not.toContain("dl-spd");
    const noBest = render(liveFrame(deltaOutputs()), { options: { "show-best-times": false } });
    expect(noBest).toContain("grid-template-columns:minmax(0, 1fr) 142px");
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
    expect(html).toMatch(/class="pos">P\d+</);
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
