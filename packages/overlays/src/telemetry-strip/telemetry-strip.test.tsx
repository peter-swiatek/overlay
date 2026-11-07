import { readFileSync } from "node:fs";
import type { DisplayPrefs } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import type { OverlayInstanceSettings } from "../contract";
import { TelemetryStripOverlay } from "./TelemetryStripOverlay";
import { telemetryStripManifest } from "./manifest";

function frame(rpm = 6400, position = 14) {
  return fixtureFrame({
    cars: [{ carIdx: 1 }],
    playerCarIdx: 1,
    session: { type: "race" },
    standings: [{ carIdx: 1, position, livePosition: position, startPosition: 20 }],
    conditions: { trackTempC: 43 },
    player: {
      isOnTrack: true,
      gear: 5,
      speedMps: 43.6,
      rpm,
      fuelL: 39,
      fuelCapacityL: 50,
      inputs: { throttle: 1, brake: 0.2, clutch: 0, steer: 0 },
      shiftLights: { firstRpm: 5200, lastRpm: 7400, shiftRpm: 7600, blinkRpm: 7800 },
      redlineRpm: 8000,
      lap: { currentLapS: 10, lastLapS: 111, bestLapS: 110, delta: null },
    },
  });
}

const settings = () => defaultInstanceSettings(telemetryStripManifest);

function render(
  f: ReturnType<typeof frame> | null,
  runtime: Parameters<typeof staticRuntime>[1] = {},
  s: OverlayInstanceSettings = settings(),
) {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <TelemetryStripOverlay settings={s} />
    </OverlayRuntimeContext.Provider>,
  );
}

function without(...ids: string[]): OverlayInstanceSettings {
  const s = settings();
  return {
    ...s,
    common: {
      ...s.common,
      fields: s.common.fields.map((f) => (ids.includes(f.id) ? { ...f, visible: false } : f)),
    },
  };
}

describe("TelemetryStripOverlay", () => {
  it("renders the values in metric units", () => {
    const html = render(frame());
    expect(html).toContain(">157<");
    expect(html).toContain("KM/H");
    expect(html).toContain(">6400<");
    expect(html).toContain(">P14<");
    expect(html).toContain("+6");
    expect(html).toContain(">78%<");
    expect(html).toContain("1:51.000");
    expect(html).toContain("43 °C");
    expect(html).toContain(">5<");
  });

  it("uses imperial units from the preferences", () => {
    const imperial: DisplayPrefs = { units: "imperial", speedInMph: true, timeFormat: "24h" };
    const html = render(frame(), { prefs: imperial });
    expect(html).toContain("MPH");
    expect(html).toContain("109 °F");
  });

  it("shows a red chip for places lost and none when level", () => {
    const lost = render(frame(6400, 24));
    expect(lost).toContain("ts-chip-loss");
    expect(lost).toContain("-4");
    expect(render(frame(6400, 20))).not.toContain("ts-chip");
  });

  it("lights LEDs by rpm and blinks at the blink point", () => {
    expect((render(frame(6400)).match(/ts-led-on/g) ?? []).length).toBe(9);
    expect((render(frame(5000)).match(/ts-led-on/g) ?? []).length).toBe(0);
    const shift = render(frame(7600));
    expect((shift.match(/ts-led-on/g) ?? []).length).toBe(16);
    expect(shift).toContain("--ov-locked-shift");
    expect(shift).not.toContain("ts-blink");
    expect(render(frame(7800))).toContain("ts-blink");
    expect(render(frame(7800), { reduceVisualEffects: true })).not.toContain("ts-blink");
  });

  it("draws the throttle and brake arcs", () => {
    const html = render(frame());
    expect(html).toContain("ts-throttle");
    expect(html).toContain("ts-brake");
    const idle = frame();
    idle.state.player.inputs = { throttle: 0, brake: 0, clutch: 0, steer: 0 };
    const idleHtml = render(idle);
    expect(idleHtml).not.toContain("ts-throttle");
    expect(idleHtml).not.toContain("ts-brake");
  });

  it("removes the block of a hidden field", () => {
    expect(render(frame(), {}, without("speed"))).not.toContain("KM/H");
    expect(render(frame(), {}, without("shift-lights"))).not.toContain("ts-leds");
    expect(render(frame(), {}, without("rpm"))).not.toContain(">RPM<");
    expect(render(frame(), {}, without("position"))).not.toContain(">P14<");
    expect(render(frame(), {}, without("fuel"))).not.toContain(">FUEL<");
    expect(render(frame(), {}, without("last-lap"))).not.toContain(">LAST<");
    expect(render(frame(), {}, without("track-temp"))).not.toContain(">TRK<");
    const noRing = render(frame(), {}, without("gear-ring"));
    expect(noRing).not.toContain("ts-ring");
    expect(noRing).toContain("ts-gear");
  });

  it("shows -- for unknown values", () => {
    const f = frame();
    f.state.player.speedMps = null;
    f.state.player.rpm = null;
    f.state.player.lap = null;
    f.state.conditions.trackTempC = null;
    f.state.player.fuelL = null;
    const html = render(f);
    expect(html.match(/>--</g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("renders nothing while inactive unless editing, then the sample", () => {
    expect(render(null)).toBe("");
    const off = frame();
    off.state.player.isOnTrack = false;
    expect(render(off)).toBe("");
    const edit = render(off, { editing: true });
    expect(edit).toContain(">157<");
    expect(edit).toContain(">7590<");
    expect(edit).toContain(">P14<");
    expect((edit.match(/ts-led-on/g) ?? []).length).toBe(10);
  });

  it("uses the custom shift pattern when the option says so", () => {
    const s = settings();
    const custom = { ...s, options: { ...s.options, "shift-lights": "custom" } };
    // 75 % of the 8000 redline is 6000: lit at 6400 (share-based), partly different from car data.
    const html = render(frame(5800), {}, custom);
    expect((html.match(/ts-led-on/g) ?? []).length).toBe(0);
    expect((render(frame(5800)).match(/ts-led-on/g) ?? []).length).toBeGreaterThan(0);
  });

  it("cuts the panel and band around the hub and draws the hub last", () => {
    const html = render(frame());
    expect(html).toContain('class="ts-panel ts-panel-cut"');
    expect(html).toContain('class="ts-band ts-band-cut"');
    expect(html.indexOf("ts-hub")).toBeGreaterThan(html.indexOf("ts-panel"));
  });

  it("styles the cuts and an opaque hub", () => {
    const css = readFileSync(new URL("./telemetry-strip.css", import.meta.url), "utf8");
    expect(css).toContain("circle 68px at 0 48px, transparent 68px, #000 68.5px");
    expect(css).toContain("circle 82px at -32px -1px, transparent 81.5px, #000 82.5px");
    const hub = css.match(/\.ts-hub \{[^}]*\}/)?.[0] ?? "";
    expect(hub).toContain("z-index: 2");
    expect(hub).toContain("var(--gear-gap)");
    expect(hub).not.toContain("--ov-bg");
    expect(css).toContain("--ts-base: rgb(from var(--ov-bg) r g b)");
    expect(css).toMatch(/:root\[data-tone="light"\] \.ts-root \{[^}]*--gear-bg: #fff/);
  });
});
