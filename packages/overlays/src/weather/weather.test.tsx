import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import type { DisplayPrefs } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import { WeatherOverlay } from "./WeatherOverlay";
import { weatherManifest } from "./manifest";

function frame(sim: "iracing" | "lmu" = "iracing"): TelemetryFrame {
  const state = emptySimState("mock");
  state.sim = sim;
  state.player.yawRad = (270 * Math.PI) / 180;
  state.conditions.windDirRad = Math.PI / 2;
  state.conditions.windSpeedMps = 5;
  state.conditions.trackTempC = 31.4;
  state.conditions.airTempC = 20;
  state.conditions.humidity = 0.456;
  state.conditions.precipitation = 0.1;
  state.conditions.wetness = 0.6;
  state.session.trackUsage = "high usage";
  return {
    seq: 1,
    source: "mock",
    status: "live",
    error: null,
    state,
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

const settings = () => defaultInstanceSettings(weatherManifest);
function render(
  f: TelemetryFrame | null,
  runtime: Parameters<typeof staticRuntime>[1] = {},
  s = settings(),
) {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <WeatherOverlay settings={s} />
    </OverlayRuntimeContext.Provider>,
  );
}
const hide = (...ids: string[]) => {
  const s = settings();
  s.common.fields = s.common.fields.map((f) => (ids.includes(f.id) ? { ...f, visible: false } : f));
  return s;
};

describe("WeatherOverlay", () => {
  const imperial: DisplayPrefs = { units: "imperial", speedInMph: false, timeFormat: "12h" };

  it("shows the live values with units", () => {
    const html = render(frame());
    expect(html).toContain("31.4 °C");
    expect(html).toContain("20.0 °C");
    expect(html).toContain("18 km/h");
    expect(html).toContain("46 %");
    expect(html).toContain("10 %");
    expect(html).toContain("High");
    expect(html).toContain("Wet");
    expect(html).toContain("wx-wet-wet");
    expect(html).toContain("width:60%");
    expect(html).toContain("from E");
  });

  it("follows the unit preferences", () => {
    const html = render(frame(), { prefs: imperial });
    expect(html).toContain("°F");
    expect(html).toContain("mph");
    expect(html).not.toContain("km/h");
  });

  it("removes a row or block with its field toggle", () => {
    expect(render(frame(), {}, hide("humidity"))).not.toContain("Humidity");
    expect(render(frame(), {}, hide("compass"))).not.toContain("wx-compass");
    const noWet = render(frame(), {}, hide("wetness"));
    expect(noWet).not.toContain("wx-wet");
    expect(noWet).toContain("Track temp");
  });

  it("shows only the LMU fields in LMU", () => {
    const f = frame("lmu");
    f.state.player.yawRad = null;
    f.state.conditions.windDirRad = null;
    const html = render(f);
    expect(html).not.toContain("wx-compass");
    expect(html).not.toContain("Humidity");
    expect(html).not.toContain("Rain");
    expect(html).not.toContain("Usage");
    expect(html).not.toContain("Wind");
    expect(html).toContain("Track temp");
    expect(html).toContain("Air temp");
    expect(html).toContain("wx-wet");
  });

  it("hides the compass for a live frame without a heading", () => {
    const f = frame();
    f.state.player.yawRad = null;
    expect(render(f)).not.toContain("wx-compass");
  });

  it("shows -- values without live data, and the sample only while editing", () => {
    const empty = render(null);
    expect(empty).toContain("--");
    expect(empty).not.toContain("28.0 °C");
    const edit = render(null, { editing: true });
    expect(edit).toContain("28.0 °C");
    expect(edit).toContain("12 km/h");
    expect(edit).toContain("Moderate");
    expect(edit).toContain("Dry");
  });

  it("prefers live data over the sample while editing", () => {
    expect(render(frame(), { editing: true })).toContain("31.4 °C");
  });
});

describe("Weather CSS", () => {
  it("uses the theme text size and the panel outline", () => {
    const css = readFileSync(join(__dirname, "weather.css"), "utf8");
    const start = css.indexOf(".wx-panel {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("font-size: calc(var(--ov-font-size, 14px) * 0.88);");
    expect(rule).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });
});
