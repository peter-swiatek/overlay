import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LapRecord, TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { deltaText, fuelText, LapTimesOverlay, temperatureText } from "./LapTimesOverlay";
import { lapTimesManifest } from "./manifest";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(lapTimesManifest);
  const settings = applySettingsPatch(lapTimesManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <LapTimesOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

function lap(lapNumber: number, lapTimeS: number, over: Partial<LapRecord> = {}): LapRecord {
  return {
    lapNumber,
    lapTimeS,
    valid: true,
    pit: false,
    trackTempC: 30.84,
    fuelUsedL: 2.4,
    sectorTimes: null,
    ...over,
  };
}

function frame(): TelemetryFrame {
  const f = fixtureFrame({
    cars: [{ carIdx: 0, carNumber: "1", driverName: "Alex Marlow" }],
    playerCarIdx: 0,
    standings: [{ carIdx: 0, stintLaps: 15 }],
  });
  f.derived.laps = {
    carIdx: 0,
    laps: [
      lap(15, 100.0),
      lap(14, 100.15),
      lap(13, 99.82),
      lap(12, 120.5, { valid: false, pit: true, fuelUsedL: null }),
      lap(11, 100.35),
    ],
    bestLapS: 99.82,
    bestLapNumber: 13,
    optimalLapS: null,
  };
  return f;
}

const css = readFileSync(join(__dirname, "lap-times.css"), "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
};

describe("lap times manifest", () => {
  it("is registered for both sims at the design size, off by default", () => {
    expect(manifestById("lap-times")).toBe(lapTimesManifest);
    expect(moduleById("lap-times")?.Component).toBe(LapTimesOverlay);
    expect(lapTimesManifest).toMatchObject({
      sims: ["iracing", "lmu"],
      defaultSize: { width: 360, height: 250 },
      defaultEnabled: false,
      table: false,
    });
  });

  it("lists five laps by default", () => {
    const s = defaultInstanceSettings(lapTimesManifest);
    expect(s.options.rows).toBe(5);
    expect(s.options["trend-laps"]).toBeUndefined();
  });
});

describe("LapTimesOverlay", () => {
  it("shows the driver without a hash and the stint", () => {
    const html = render(frame());
    expect(html).toContain('Driver</span><span class="lt-value">1 A. Marlow</span>');
    expect(html).toContain("15 Laps");
    expect(html).not.toContain("#1");
  });

  it("lists the laps newest first with three-decimal lap times", () => {
    const html = render(frame());
    const laps = [...html.matchAll(/data-lap="(\d+)"/g)].map((m) => m[1]);
    expect(laps).toEqual(["15", "14", "13", "12", "11"]);
    expect(html).toContain("1:40.000");
    expect(html).toContain("1:39.820");
  });

  it("marks the newest row, the best lap and the zebra rows, but never an own row", () => {
    const html = render(frame());
    expect(html).toContain('class="lt-row lt-row--alt lt-row--newest" data-lap="15"');
    expect(html).toContain('class="lt-row" data-lap="14"');
    expect(html).toContain('<span class="lt-time lt-fastest">1:39.820</span>');
    expect(html).not.toContain("ov-row--own");
  });

  it("colours deltas and mutes the pit lap", () => {
    const html = render(frame());
    expect(html).toContain('<span class="lt-gain">-0.15</span>');
    expect(html).toContain('<span class="lt-loss">+0.33</span>');
    expect(html).toContain('class="lt-row lt-row--invalid" data-lap="12"');
    expect(html).toContain('<span class="lt-tag">PIT</span>');
  });

  it("shows track temperature and fuel used", () => {
    const html = render(frame());
    expect(html).toContain("30.8°");
    expect(html).toContain("2.40 L");
  });

  it("shows the session best box with its lap", () => {
    const html = render(frame());
    expect(html).toContain(
      '<span class="lt-sb-label">SESSION BEST</span><span class="lt-sb-time">1:39.820</span>',
    );
    expect(html).toContain('<span class="lt-sb-lap">13</span>');
    expect(render(frame(), { "show-session-best": false })).not.toContain("SESSION BEST");
  });

  it("has no pace trend", () => {
    const html = render(frame());
    expect(html).not.toContain("PACE TREND");
    expect(html).not.toContain("lt-bar");
  });

  it("has best, average and an empty optimal in the footer", () => {
    const html = render(frame());
    expect(html).toContain('Best</span><span class="lt-value lt-fastest">1:39.820</span>');
    expect(html).toContain("Avg (5L)");
    expect(html).toContain('Opt</span><span class="lt-value">--</span>');
  });

  it("hides columns and sections that are switched off", () => {
    const html = render(frame(), {
      "col-fuel": false,
      "col-track": false,
      "show-top-bar": false,
      "show-footer": false,
    });
    expect(html).not.toContain("2.40 L");
    expect(html).not.toContain(">Track<");
    expect(html).not.toContain("Driver");
    expect(html).not.toContain("Avg (5L)");
    expect(html).toContain("grid-template-columns:3.1em minmax(5.6em, 1fr) 4.6em");
  });

  it("follows the rows setting", () => {
    const html = render(frame(), { rows: 2 });
    expect([...html.matchAll(/data-lap=/g)]).toHaveLength(2);
  });

  it("says so before the first lap", () => {
    const f = frame();
    f.derived.laps = null;
    const html = render(f);
    expect(html).toContain("No completed laps yet");
    expect(html).toContain('Best</span><span class="lt-value">--</span>');
  });

  it("waits without data, and shows the design's sample while editing", () => {
    expect(render(null)).toContain("Waiting for laps");
    const html = render(null, {}, { editing: true });
    expect(html).toContain("1 A. Marlow");
    expect(html).toContain("1:40.000");
    expect(html).not.toContain("PACE TREND");
  });
});

describe("formatting", () => {
  it("signs the delta with two decimals", () => {
    expect(deltaText(-0.15)).toBe("-0.15");
    expect(deltaText(0.333)).toBe("+0.33");
    expect(deltaText(0)).toBe("0.00");
    expect(deltaText(null)).toBe("--");
  });

  it("follows the unit preference", () => {
    const metric = { units: "metric", speedInMph: false, timeFormat: "24h" } as const;
    const imperial = { ...metric, units: "imperial" } as const;
    expect(temperatureText(31, metric)).toBe("31.0°");
    expect(temperatureText(30, imperial)).toBe("86.0°");
    expect(fuelText(2.4, metric)).toBe("2.40 L");
    expect(fuelText(3.785411784, imperial)).toBe("1.00 gal");
    expect(fuelText(null, metric)).toBe("--");
  });
});

describe("lap-times.css", () => {
  it("sizes the panel from the theme font size and draws the inset border", () => {
    expect(rule(".lt")).toContain("font-size: var(--ov-font-size, 14px)");
    expect(rule(".lt::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border)");
  });

  it("uses only theme tokens and locked colours", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(rule(".lt-fastest")).toContain("var(--ov-locked-fastest)");
    expect(rule(".lt-gain")).toContain("var(--ov-locked-gain)");
    expect(rule(".lt-loss")).toContain("var(--ov-locked-loss)");
  });
});
