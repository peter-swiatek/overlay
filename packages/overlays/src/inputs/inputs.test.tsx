import { readFileSync } from "node:fs";
import { join } from "node:path";
// Tests may use the sim-core entry for fixtures; overlay code itself must not.
import { emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { DEFAULT_DISPLAY_PREFS } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { InputsOverlay, InputsPanel } from "./InputsOverlay";
import { inputsModule } from "./index";
import { inputsManifest } from "./manifest";
import type { InputSample } from "./trace";
import { inputsView } from "./view";

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
      gaps: [],
    },
  };
}

function frameWith(): TelemetryFrame {
  const f = liveFrame();
  f.state.tickTimeS = 20;
  f.state.player.inputs = { throttle: 0.5, brake: 0.25, clutch: 1, steer: 0.5 };
  f.state.player.gear = 3;
  f.state.player.speedMps = 50;
  return f;
}

const defaults = defaultInstanceSettings(inputsManifest);

function render(frame: TelemetryFrame, settings = defaults, prefs = DEFAULT_DISPLAY_PREFS): string {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(frame, { prefs })}>
      <InputsOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const sample = (t: number, abs = false): InputSample => ({
  t,
  throttle: 0.5,
  brake: 1,
  clutch: 0,
  steer: 0,
  abs,
});

function panel(over: Partial<React.ComponentProps<typeof InputsPanel>> = {}): string {
  return renderToStaticMarkup(
    <InputsPanel
      view={inputsView(frameWith())}
      samples={[sample(19), sample(20)]}
      windowS={3}
      prefs={DEFAULT_DISPLAY_PREFS}
      showHub
      showTrace
      showBars
      showClutch
      showSteering
      {...over}
    />,
  );
}

describe("InputsOverlay", () => {
  it("renders hub, trace and bars with the frame's values", () => {
    const html = render(frameWith());
    expect(html).toContain("inp-hub");
    expect(html).toContain("inp-well");
    expect(html).toContain("inp-bars");
    expect(html).toContain(">3<");
    expect(html).toContain(">180<");
    expect(html).toContain("height:50%");
    expect(html).toContain("height:25%");
    expect(html).toContain("height:100%");
  });

  it("shows imperial speed when the preferences say so", () => {
    const html = render(frameWith(), defaults, {
      units: "imperial",
      speedInMph: false,
      timeFormat: "12h",
    });
    expect(html).toContain(">112<");
    expect(html).toContain("112 mph");
  });

  it("hides areas with their field toggles and leaves the rest", () => {
    const fields = defaults.common.fields.map((f) => ({ ...f, visible: f.id === "bars" }));
    const html = render(frameWith(), { ...defaults, common: { ...defaults.common, fields } });
    expect(html).not.toContain("inp-hub");
    expect(html).not.toContain("inp-well");
    expect(html).toContain("inp-bars");
  });

  it("shows no ABS path without ABS samples", () => {
    expect(render(frameWith())).not.toContain("inp-line-abs");
  });

  it("shows the idle panel before a live frame", () => {
    const html = render({ ...liveFrame(), status: "waiting" });
    expect(html).toContain("inp-panel");
    expect(html).toContain(">-<");
  });
});

describe("InputsPanel", () => {
  it("draws the clutch and steering lines only when enabled", () => {
    const on = panel();
    expect(on).toContain("inp-line-clutch");
    expect(on).toContain("inp-line-steer");
    expect(on).toContain('data-bar="clutch"');
    const off = panel({ showClutch: false, showSteering: false });
    expect(off).not.toContain("inp-line-clutch");
    expect(off).not.toContain("inp-line-steer");
    expect(off).not.toContain('data-bar="clutch"');
    expect(off).toContain("inp-line-throttle");
    expect(off).toContain("inp-line-brake");
  });

  it("adds the ABS path only when a sample has ABS", () => {
    expect(panel()).not.toContain("inp-line-abs");
    const html = panel({ samples: [sample(18), sample(19, true), sample(20)] });
    expect(html).toContain("inp-line-abs");
  });

  it("rotates the steering pill by the wheel angle", () => {
    const f = frameWith();
    f.state.player.steerMaxRad = Math.PI * 2;
    expect(panel({ view: inputsView(f) })).toContain("rotate(180.0 44.5 44.5)");
    expect(panel({ view: inputsView(frameWith()) })).toContain("rotate(90.0 44.5 44.5)");
  });

  it("describes gear and speed for screen readers", () => {
    expect(panel()).toContain('aria-label="Inputs: gear 3, 180 km/h"');
  });
});

describe("inputsModule", () => {
  it("is a regular overlay that starts off and hidden in the garage", () => {
    expect(inputsModule.manifest.dev).toBeUndefined();
    expect(defaults.enabled).toBe(false);
    expect(defaults.common.hideInGarage).toBe(true);
    expect(inputsManifest.defaultSize).toEqual(inputsManifest.minSize);
  });

  it("has the trace length, clutch and steering options", () => {
    expect(defaults.options).toEqual({
      "trace-seconds": 3,
      "show-clutch": true,
      "show-steering-trace": true,
    });
    const patched = applySettingsPatch(inputsManifest, defaults, {
      options: { "trace-seconds": 99 },
    });
    expect(patched.options["trace-seconds"]).toBe(10);
  });
});

describe("Inputs CSS", () => {
  it("outlines the trace panel above the traces", () => {
    const css = readFileSync(join(__dirname, "inputs.css"), "utf8");
    const start = css.indexOf(".inp-well::after {");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(css.slice(start, css.indexOf("}", start))).toContain(
      "box-shadow: inset 0 0 0 1px var(--ov-border);",
    );
  });
});
