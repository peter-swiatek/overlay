import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SetupSide, TelemetryFrame } from "@overlay/sim-core/types";
import { DEFAULT_DISPLAY_PREFS } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { setupCompareManifest } from "./manifest";
import {
  SetupCompareOverlay,
  deltaText,
  fuelText,
  topSpeedText,
  topSpeedTone,
} from "./SetupCompareOverlay";
import { compareView } from "./view";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(setupCompareManifest);
  const settings = applySettingsPatch(setupCompareManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <SetupCompareOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const side = (name: string, patch: Partial<SetupSide> = {}): SetupSide => ({
  name,
  laps: 5,
  bestLapS: 100.184,
  avgLapS: 100.342,
  sectorsS: [31.421, 41.883, 26.88],
  topSpeedMps: 265 / 3.6,
  fuelPerLapL: 2.4,
  ...patch,
});

function frame(baseline: SetupSide, active: SetupSide, pinned = false): TelemetryFrame {
  const f = fixtureFrame({ cars: [{ carIdx: 0 }], playerCarIdx: 0 });
  f.derived.setupCompare = { baseline, active, pinned };
  return f;
}

const rows = (html: string) =>
  [...html.matchAll(/class="(sc-row[^"]*)" data-row/g)].map((m) => m[1]);

describe("setup compare manifest", () => {
  it("is a 340 x 210 iRacing-only panel, off by default, and registered", () => {
    const m = setupCompareManifest;
    expect(m.id).toBe("setup-compare");
    expect(m.sims).toEqual(["iracing"]);
    expect(m.defaultSize).toEqual({ width: 340, height: 210 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(defaultInstanceSettings(m).options["pin-baseline"]).toBe(false);
    expect(manifestById("setup-compare")).toBe(m);
    expect(moduleById("setup-compare")?.Component).toBe(SetupCompareOverlay);
  });
});

describe("SetupCompareOverlay", () => {
  const active = side("spa_lowdf_v2", {
    bestLapS: 99.817,
    avgLapS: 100.018,
    sectorsS: [31.244, 41.828, 26.745],
    topSpeedMps: 268.4 / 3.6,
    fuelPerLapL: 2.38,
  });

  it("shows the header, the table and the footer like the design, with three decimals", () => {
    const html = render(frame(side("spa_race_v1"), active));
    expect(html).toContain(">Base<");
    expect(html).toContain(">spa_race_v1<");
    expect(html).toContain('sc-value sc-active">spa_lowdf_v2<');
    for (const h of ["Metric", "Baseline", "Active", "Delta"]) expect(html).toContain(`>${h}<`);
    expect(html).toContain(">1:40.184<");
    expect(html).toContain('sc-fastest">1:39.817<');
    expect(html).toContain('sc-gain">-0.367 s<');
    expect(html).toContain(">5-Lap Avg<");
    expect(html).toContain(">31.421<");
    expect(html).toContain(">Sector 3<");
    expect(html).toContain('sc-gain">+3.4 km/h<');
    expect(html).toContain(">2.38 L (-0.02)<");
  });

  it("uses plain zebra rows", () => {
    expect(rows(render(frame(side("a"), active)))).toEqual([
      "sc-row sc-row--alt",
      "sc-row",
      "sc-row sc-row--alt",
      "sc-row",
      "sc-row sc-row--alt",
    ]);
  });

  it("shows the baseline values and no deltas when the baseline is the active setup", () => {
    const html = render(frame(side("a"), side("a"), true));
    expect(html).toContain(">Pinned<");
    expect(html.match(/>1:40\.184</g)).toHaveLength(2);
    expect(html).not.toContain("sc-fastest");
    expect(html).not.toContain("sc-gain");
    expect(html).toContain(">2.40 L<");
  });

  it("hides the sectors and the footer from the settings", () => {
    const html = render(frame(side("a"), active), { "show-sectors": false, "show-footer": false });
    expect(rows(html)).toHaveLength(2);
    expect(html).not.toContain("Top Speed");
  });

  it("waits without data and shows the sample when editing", () => {
    expect(render(null)).toContain("Waiting for a car setup");
    const html = render(null, {}, { editing: true });
    expect(html).toContain(">spa_race_v1<");
    expect(html).toContain('sc-fastest">1:39.817<');
    expect(rows(html)).toHaveLength(5);
  });
});

describe("setup compare text", () => {
  const prefs = DEFAULT_DISPLAY_PREFS;
  it("formats deltas, top speed and fuel", () => {
    expect(deltaText(-0.36)).toBe("-0.360 s");
    expect(deltaText(0.05)).toBe("+0.050 s");
    expect(deltaText(0)).toBe("0.000 s");
    expect(deltaText(null)).toBe("--");
    expect(topSpeedText(-1 / 3.6, prefs)).toBe("-1.0 km/h");
    expect(topSpeedText(0.001, prefs)).toBe("0.0 km/h");
    expect(topSpeedTone(0.001, prefs)).toBeNull();
    expect(topSpeedTone(-1, prefs)).toBe("loss");
    expect(topSpeedText(1, { ...prefs, speedInMph: true })).toBe("+2.2 mph");
    expect(topSpeedText(null, prefs)).toBe("--");
    const v = compareView(side("a"), side("b", { fuelPerLapL: 2.45 }), false, { sectors: true });
    expect(fuelText(v, prefs)).toBe("2.45 L (+0.05)");
    expect(fuelText({ ...v, fuelPerLapL: null }, prefs)).toBe("--");
  });
});

describe("Setup Compare CSS", () => {
  const css = readFileSync(join(__dirname, "setup-compare.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size and the panel outline", () => {
    expect(rule(".sc")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".sc::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });

  it("takes its colours only from theme tokens and locked colours", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".sc-active")).toContain("var(--ov-accent)");
    expect(rule(".sc-fastest")).toContain("var(--ov-locked-fastest)");
    expect(rule(".sc-gain")).toContain("var(--ov-locked-gain)");
    expect(rule(".sc-loss")).toContain("var(--ov-locked-loss)");
  });

  it("sizes in em, not px", () => {
    expect(
      css.match(/\d+px/g)?.filter((p) => !["1px", "6px", "7px", "14px", "24px"].includes(p)),
    ).toEqual([]);
  });
});
