// Tests may use the sim-core entry for fixtures; overlay code itself must not.
import { emptyCar, emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import type { DisplayPrefs } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import { PitSpeedOverlay } from "./PitSpeedOverlay";
import { pitSpeedManifest } from "./manifest";
import { EDIT_SAMPLE, pitSpeedView } from "./view";

function frame(opts: { pitRoad?: boolean; limiter?: boolean; limit?: number | null } = {}) {
  const f: TelemetryFrame = {
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
      gaps: [],
    },
  };
  const s = f.state;
  s.playerCarIdx = 3;
  s.session.trackLengthM = 4000;
  s.session.pitSpeedLimitMps = opts.limit === undefined ? 22.22 : opts.limit;
  s.player.speedMps = 20;
  s.player.pitLimiter = opts.limiter ?? false;
  s.cars = [
    {
      ...emptyCar(3),
      carIdx: 3,
      onPitRoad: opts.pitRoad ?? true,
      inPitStall: false,
      lapDistPct: 0.98,
    },
  ];
  return f;
}

describe("pitSpeedView", () => {
  it("is active on pit road or with the limiter on", () => {
    expect(pitSpeedView(frame({ pitRoad: true })).active).toBe(true);
    expect(pitSpeedView(frame({ pitRoad: false, limiter: true })).active).toBe(true);
    expect(pitSpeedView(frame({ pitRoad: false })).active).toBe(false);
  });

  it("is inactive when not live or without a frame", () => {
    const f = frame();
    f.status = "waiting";
    expect(pitSpeedView(f).active).toBe(false);
    expect(pitSpeedView(null).active).toBe(false);
  });

  it("applies the tolerance for over and under", () => {
    const f = frame();
    f.state.player.speedMps = 22.22 + 0.2;
    expect(pitSpeedView(f).state).toBe("under");
    f.state.player.speedMps = 22.22 + 0.5;
    const v = pitSpeedView(f);
    expect(v.state).toBe("over");
    expect(v.overMps).toBe(0.5);
  });

  it("clamps the bar position at +-1 and rounds speed", () => {
    const f = frame();
    f.state.player.speedMps = 40;
    expect(pitSpeedView(f).barPosition).toBe(1);
    f.state.player.speedMps = 0;
    expect(pitSpeedView(f).barPosition).toBe(-1);
    f.state.player.speedMps = 21.0449;
    expect(pitSpeedView(f).speedMps).toBe(21);
  });

  it("has no limit, state or bar when the sim reports none", () => {
    const v = pitSpeedView(frame({ limit: null }));
    expect(v.limitMps).toBeNull();
    expect(v.state).toBeNull();
    expect(v.barPosition).toBeNull();
    expect(v.speedMps).toBe(20);
  });

  it("measures the distance to the box across the S/F wrap", () => {
    const f = frame();
    f.state.player.pitStallLapDistPct = 0.03;
    expect(pitSpeedView(f).distanceToBoxM).toBe(200);
  });

  it("shows the distance on pit road even when the box is more than half a lap ahead", () => {
    const f = frame();
    f.state.player.pitStallLapDistPct = 0.9;
    expect(pitSpeedView(f).distanceToBoxM).toBeGreaterThan(0);
  });

  it("gives no distance off pit road", () => {
    const g = frame({ pitRoad: false, limiter: true });
    g.state.player.pitStallLapDistPct = 0.03;
    expect(pitSpeedView(g).distanceToBoxM).toBeNull();
  });
});

function render(
  f: TelemetryFrame | null,
  runtime: Parameters<typeof staticRuntime>[1] = {},
  s = settings(),
) {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <PitSpeedOverlay settings={s} />
    </OverlayRuntimeContext.Provider>,
  );
}
const settings = () => defaultInstanceSettings(pitSpeedManifest);

describe("PitSpeedOverlay", () => {
  const imperial: DisplayPrefs = { units: "imperial", speedInMph: false, timeFormat: "12h" };

  it("shows km/h or mph from the preferences", () => {
    expect(render(frame())).toContain("km/h");
    const html = render(frame(), { prefs: imperial });
    expect(html).toContain("mph");
    expect(html).not.toContain("km/h");
  });

  it("shows the limiter state", () => {
    expect(render(frame({ limiter: true }))).toContain("ON");
    expect(render(frame({ limiter: false }))).toContain("OFF");
  });

  it("says the limit is not reported and draws no bar for LMU", () => {
    const html = render(frame({ limit: null }));
    expect(html).toContain("Limit not reported");
    expect(html).not.toContain("ps-bar");
  });

  it("uses the loss colour class over the limit", () => {
    const f = frame();
    f.state.player.speedMps = 30;
    const html = render(f);
    expect(html).toContain("ps-over");
    expect(html).toContain("ps-fill-over");
    expect(render(frame())).toContain("ps-fill-under");
  });

  it("shows the box distance and the in-stall state", () => {
    const f = frame();
    f.state.player.pitStallLapDistPct = 0.03;
    expect(render(f)).toContain("Box in 200 m");
    expect(render(f, { prefs: imperial })).toContain("ft");
    f.state.cars[0]!.inPitStall = true;
    expect(render(f)).toContain("In pit stall");
  });

  it("leaves out hidden fields and follows the configured order", () => {
    const s = settings();
    s.common.fields = [
      { id: "limiter", visible: true, widthPct: null },
      { id: "speed", visible: true, widthPct: null },
      { id: "limit", visible: false, widthPct: null },
      { id: "pit-stop-info", visible: false, widthPct: null },
    ];
    const html = render(frame(), {}, s);
    expect(html).not.toContain("Limit ");
    expect(html.indexOf("ps-pill")).toBeLessThan(html.indexOf("ps-speed"));
  });

  it("renders nothing when not active, the sample when editing", () => {
    const idle = frame({ pitRoad: false });
    expect(render(idle)).toBe("");
    const html = render(idle, { editing: true });
    expect(html).toContain("ps-panel");
    expect(html).toContain("Limit");
    expect(EDIT_SAMPLE.active).toBe(true);
  });
});
