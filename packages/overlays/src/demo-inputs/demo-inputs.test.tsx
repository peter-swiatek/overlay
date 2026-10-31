// Tests may use the sim-core entry for fixtures; overlay code itself must not.
import { emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { DemoInputsOverlay } from "./DemoInputsOverlay";
import { demoInputsModule } from "./index";
import { formatGear, formatSpeed, inputsView } from "./view";

function liveFrame(): TelemetryFrame {
  return {
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
}

describe("inputsView", () => {
  it("clamps the player's inputs and keeps speed in m/s", () => {
    const frame = liveFrame();
    frame.state.player.inputs = { throttle: 0.4, brake: 1.5, clutch: null, steer: -2 };
    frame.state.player.gear = 4;
    frame.state.player.speedMps = 50;
    expect(inputsView(frame)).toEqual({
      throttle: 0.4,
      brake: 1,
      clutch: 0,
      steer: -1,
      gear: 4,
      speedMps: 50,
    });
  });

  it("is all zero unless live", () => {
    const frame = liveFrame();
    frame.state.player.speedMps = 50;
    expect(inputsView({ ...frame, status: "waiting" }).speedMps).toBe(0);
    expect(inputsView(null).throttle).toBe(0);
  });
});

describe("formatters", () => {
  it("formats gears", () => {
    expect([-1, 0, 3].map(formatGear)).toEqual(["R", "N", "3"]);
  });

  it("honours the speed unit preferences", () => {
    const base = { units: "metric", speedInMph: false, timeFormat: "24h" } as const;
    expect(formatSpeed(50, base)).toBe("180 km/h");
    expect(formatSpeed(50, { ...base, speedInMph: true })).toBe("112 mph");
    expect(formatSpeed(50, { ...base, units: "imperial" })).toBe("112 mph");
  });
});

describe("DemoInputsOverlay", () => {
  it("renders bars, gear and speed from the runtime", () => {
    const frame = liveFrame();
    frame.state.player.inputs = { throttle: 0.5, brake: 0, clutch: 0, steer: 0 };
    frame.state.player.gear = 3;
    frame.state.player.speedMps = 50;
    const html = renderToStaticMarkup(
      <OverlayRuntimeContext.Provider value={staticRuntime(frame)}>
        <DemoInputsOverlay />
      </OverlayRuntimeContext.Provider>,
    );
    expect(html).toContain("height:50.0%");
    expect(html).toContain(">3<");
    expect(html).toContain("180 km/h");
  });

  it("shows imperial speed when the preferences say so", () => {
    const frame = liveFrame();
    frame.state.player.speedMps = 50;
    const runtime = staticRuntime(frame, {
      prefs: { units: "imperial", speedInMph: false, timeFormat: "12h" },
    });
    const html = renderToStaticMarkup(
      <OverlayRuntimeContext.Provider value={runtime}>
        <DemoInputsOverlay />
      </OverlayRuntimeContext.Provider>,
    );
    expect(html).toContain("112 mph");
  });
});

describe("demoInputsModule", () => {
  it("is a developer-only overlay that starts off", () => {
    expect(demoInputsModule.manifest.dev).toBe(true);
    expect(demoInputsModule.manifest.defaultEnabled).toBe(false);
  });
});
