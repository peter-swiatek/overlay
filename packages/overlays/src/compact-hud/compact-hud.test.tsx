import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Player, TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import { CompactHudOverlay } from "./CompactHudOverlay";
import { compactHudManifest } from "./manifest";

const settings = () => defaultInstanceSettings(compactHudManifest);

function render(
  f: TelemetryFrame | null,
  runtime: Parameters<typeof staticRuntime>[1] = {},
): string {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <CompactHudOverlay settings={settings()} />
    </OverlayRuntimeContext.Provider>,
  );
}

interface Scene {
  player?: Partial<Player>;
  gaps?: Array<{ carIdx: number; gapS: number; laps?: number }>;
  nearby?: number[];
  meDist?: number;
  slow?: number;
  pitExitM?: number;
}

function scene(s: Scene = {}): TelemetryFrame {
  const gaps = s.gaps ?? [];
  const f = fixtureFrame({
    playerCarIdx: 0,
    session: { trackLengthM: 4000, typeName: "Race" },
    player: {
      isOnTrack: true,
      speedMps: 46.7,
      gear: 4,
      rpm: 6620,
      redlineRpm: 8000,
      shiftLights: { firstRpm: 5200, shiftRpm: 7600, lastRpm: 7400, blinkRpm: 7800 },
      inputs: { throttle: 0.92, brake: 0, clutch: 0, steer: -0.18 },
      ...s.player,
    },
    cars: [
      { carIdx: 0, lapsCompleted: 3, lapDistPct: s.meDist ?? 0.5, onPitRoad: false },
      ...gaps.map((g) => ({
        carIdx: g.carIdx,
        lapsCompleted: g.laps ?? 3,
        lapDistPct: 0.5,
        onPitRoad: false,
      })),
    ],
    gaps: gaps.map((g) => ({ carIdx: g.carIdx, gapS: g.gapS, tier: "estimate" as never })),
  });
  if (s.nearby) {
    f.derived.proximity = {
      carLeftRight: "clear" as never,
      left: null,
      right: null,
      nearby: s.nearby.map((m, i) => ({
        carIdx: 10 + i,
        longitudinalM: m,
        lateralM: null,
        side: null,
      })),
      carLengthM: 4.5,
    };
  }
  if (s.slow !== undefined) {
    f.derived.slowCar = { carIdx: 9, distanceM: s.slow, speedMps: 8, stopped: false };
  }
  if (s.pitExitM !== undefined) f.derived.track.pitExitDistanceM = s.pitExitM;
  return f;
}

describe("CompactHudOverlay scenarios", () => {
  it("race: partial lights, both tabs, a yellow proximity line, a lapping line", () => {
    const html = render(
      scene({
        gaps: [
          { carIdx: 1, gapS: -1.2 },
          { carIdx: 2, gapS: 0.8, laps: 2 },
        ],
        nearby: [8],
      }),
    );
    expect(html).toContain("+1.2");
    expect(html).toContain("-0.8");
    expect(html).toContain("hud-light--on");
    expect(html).toContain("var(--ov-locked-flag-yellow)");
    expect(html).toContain("var(--ov-locked-flag-blue)");
    expect(html).toContain("hud-prox--ahead");
    expect(html).not.toContain("hud-prox--behind");
    expect(html).toContain("km/h");
    expect(html).toContain(">6620<");
    expect(html).toContain(">4<");
  });

  it("braking: ABS badge, brake arc and red proximity lines", () => {
    const html = render(
      scene({
        player: { absActive: true, inputs: { throttle: 0, brake: 0.86, clutch: 0, steer: 0 } },
        nearby: [3, -4],
      }),
    );
    expect(html).toContain("hud-badge--abs");
    expect(html).toContain("stroke-dasharray:86 100");
    expect(html).toContain("background:var(--ov-locked-loss)");
    expect(html).toContain("hud-prox--behind");
  });

  it("shift: every light and the gear in the shift colour, blinking, red lapping line", () => {
    const html = render(
      scene({
        player: { rpm: 7900 },
        gaps: [{ carIdx: 1, gapS: -1, laps: 5 }],
      }),
    );
    expect(html).toContain("hud-gear--shift");
    expect(html).toContain("hud-blink");
    expect(html).toContain("background:var(--ov-locked-shift)");
    expect(html).toContain("stroke:var(--ov-locked-loss)");
  });

  it("pit-box: limiter badge, green outline, cyan BOX chip, marker from the distance, no tabs", () => {
    const html = render(
      scene({
        meDist: 0.9,
        player: { pitLimiter: true, trackSurface: "approachingPits", pitStallLapDistPct: 0.915 },
      }),
    );
    expect(html).toContain("hud-badge--lim");
    expect(html).toContain("hud-body--lim");
    expect(html).toContain('class="hud-win"');
    expect(html).toContain("hud-pit-line");
    expect(html).toContain("<small>BOX</small><b>060</b><small>m</small>");
    expect(html).toContain("background:var(--ov-locked-pit-box)");
    expect(html).toContain("transform:translateY(52.8px)");
    expect(html).toContain('aria-label="Pit box in 60 metres"');
    expect(html).not.toContain("hud-tab");
  });

  it("in-box: BOX 000 with the marker on the line, gear N, 0 km/h", () => {
    const html = render(
      scene({
        meDist: 0.9,
        player: {
          pitLimiter: true,
          trackSurface: "inPitStall",
          pitStallLapDistPct: 0.9,
          gear: 0,
          speedMps: 0,
        },
      }),
    );
    expect(html).toContain("<small>BOX</small><b>000</b><small>m</small>");
    expect(html).toContain("transform:translateY(20px)");
    expect(html).toContain(">N<");
    expect(html).toContain(">0<");
  });

  it("pit-exit: magenta EXIT chip", () => {
    const html = render(
      scene({
        meDist: 0.9,
        pitExitM: 30,
        player: { pitLimiter: true, trackSurface: "approachingPits", pitStallLapDistPct: 0.8 },
      }),
    );
    expect(html).toContain("<small>EXIT</small><b>030</b><small>m</small>");
    expect(html).toContain("background:var(--ov-locked-pit-exit)");
    expect(html).toContain('aria-label="Pit exit in 30 metres"');
  });

  it("draws no pit guide off pit road or when the option is off", () => {
    expect(render(scene())).not.toContain("hud-pit");
    const off = defaultInstanceSettings(compactHudManifest);
    off.options["show-pit-guide"] = false;
    const html = renderToStaticMarkup(
      <OverlayRuntimeContext.Provider
        value={staticRuntime(
          scene({
            meDist: 0.9,
            player: { trackSurface: "approachingPits", pitStallLapDistPct: 0.95 },
          }),
          {},
        )}
      >
        <CompactHudOverlay settings={off} />
      </OverlayRuntimeContext.Provider>,
    );
    expect(html).not.toContain("hud-pit");
  });

  it("slow car: the yellow pill", () => {
    const html = render(scene({ slow: 180 }));
    expect(html).toContain("hud-status--slow");
    expect(html).toContain("▲ Slow car ahead · 180 m");
  });

  it("slow car: no pill on pit road", () => {
    const html = render(
      scene({
        slow: 180,
        meDist: 0.9,
        player: { trackSurface: "approachingPits", pitStallLapDistPct: 0.95 },
      }),
    );
    expect(html).not.toContain("hud-status");
    expect(html).toContain("hud-pit-chip");
  });

  it("idle: gear N, no tabs, no pills, no badges", () => {
    const html = render(
      scene({
        player: {
          gear: 0,
          rpm: 900,
          speedMps: 0,
          inputs: { throttle: 0, brake: 0, clutch: 0, steer: 0 },
        },
      }),
    );
    expect(html).toContain(">N<");
    for (const c of ["hud-tab", "hud-status", "hud-badge", "hud-prox", "hud-blink", "hud-pit"]) {
      expect(html).not.toContain(c);
    }
  });

  it("draws the outline for the tabs shown", () => {
    const html = render(scene({ gaps: [{ carIdx: 1, gapS: -1 }] }));
    expect(html).toContain("L214,28 C230,28 228,48 244,48");
    expect(html).not.toContain("C228,148");
  });

  it("describes itself for screen readers", () => {
    const html = render(scene({ gaps: [{ carIdx: 1, gapS: -1.2 }] }));
    expect(html).toContain('aria-label="Speed 168 km/h, gear 4, 1.2 seconds to the car ahead"');
  });

  it("does not blink with reduced visual effects", () => {
    const f = scene({ player: { rpm: 7900 } });
    expect(render(f)).toContain("hud-blink");
    const calm = render(f, { reduceVisualEffects: true });
    expect(calm).not.toContain("hud-blink");
    expect(calm).toContain("hud-gear--shift");
  });
});

describe("CompactHudOverlay activity", () => {
  it("renders nothing while inactive unless editing", () => {
    expect(render(null)).toBe("");
    expect(render(scene({ player: { isOnTrack: false } }))).toBe("");
  });

  it("shows the sample while editing and inactive", () => {
    const html = render(null, { editing: true });
    expect(html).toContain("hud-cap");
    expect(html).toContain("+1.2");
    expect(html).toContain("-0.8");
    expect(html).toContain(">168<");
  });

  it("shows live data while editing and active", () => {
    const html = render(scene({ player: { speedMps: 20 } }), { editing: true });
    expect(html).toContain(">72<");
  });
});

describe("Compact HUD CSS", () => {
  it("draws speed and RPM in white at the design size", () => {
    const css = readFileSync(join(__dirname, "compact-hud.css"), "utf8");
    const start = css.indexOf(".hud-num b {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("color: var(--ov-text);");
    expect(rule).toContain("font-size: 1.38em;");
  });
});
