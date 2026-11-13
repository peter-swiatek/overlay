import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOMINAL_TABLE_METRICS } from "@overlay/ui/fit";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import {
  applySettingsPatch,
  defaultInstanceSettings,
  sanitizeInstanceSettings,
  sanitizeOptionValue,
} from "../settings";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { tableWidthsFor } from "../shared/table-fit";
import { BattleBoxOverlay, sectorDeltaText } from "./BattleBoxOverlay";
import { battleBoxManifest } from "./manifest";
import { battleFrame } from "./test-support";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string | readonly string[]> = {},
): string {
  const base = defaultInstanceSettings(battleBoxManifest);
  const settings = applySettingsPatch(battleBoxManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f)}>
      <BattleBoxOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const css = readFileSync(join(__dirname, "battle-box.css"), "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
};

describe("battle box manifest", () => {
  it("is a registered table overlay for both sims", () => {
    expect(manifestById("battle-box")).toBe(battleBoxManifest);
    expect(moduleById("battle-box")?.manifest).toBe(battleBoxManifest);
    expect(battleBoxManifest).toMatchObject({ table: true, sims: ["iracing", "lmu"] });
  });

  it("shows the design's columns by default", () => {
    expect(battleBoxManifest.fields.filter((f) => f.defaultVisible).map((f) => f.id)).toEqual([
      "position",
      "car-number",
      "driver",
      "irating",
      "last-lap",
      "interval",
    ]);
  });

  it("defaults the window width to the computed fit and the height to the design's", () => {
    const widths = tableWidthsFor(
      battleBoxManifest,
      defaultInstanceSettings(battleBoxManifest),
      NOMINAL_TABLE_METRICS,
    );
    if (widths === null || widths.fitPx === null) throw new Error("table manifest");
    expect(battleBoxManifest.defaultSize).toEqual({ width: Math.ceil(widths.fitPx), height: 150 });
  });

  it("has the sector strips on and 3 lap-time decimals by default", () => {
    const settings = defaultInstanceSettings(battleBoxManifest);
    expect(settings.options["sector-strips"]).toBe(true);
    expect(settings.options["lap-decimals"]).toBe(3);
    for (const field of battleBoxManifest.settings) {
      expect(sanitizeOptionValue(field, field.default)).toEqual(field.default);
    }
  });
});

describe("BattleBoxOverlay", () => {
  it("renders ahead, you and behind in order, with the own row and the design's header", () => {
    const html = render(battleFrame());
    const order = ["M. Castellan", "A. Marlow", "D. Okonkwo"].map((n) => html.indexOf(n));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1] ?? -1);
    expect(order[1]).toBeLessThan(order[2] ?? -1);
    expect(html).not.toContain("A. Leader");
    expect(html).not.toContain("D. Other");
    expect(html.match(/ov-row--own/g)).toHaveLength(1);
    for (const label of ["Pos", "Car", "Driver", "iR", "Last", "Int"]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("draws the car number without a hash and the class colour on the position cell", () => {
    const html = render(battleFrame());
    expect(html).toContain('<span class="ov-car-num">22</span>');
    expect(html).not.toContain("#22");
    expect(html).toContain("ov-cell--pos");
    expect(html).toContain("--class-color:#ffda59");
  });

  it("prints the last lap with 3 decimals and the line gaps, never coloured by closeness", () => {
    const html = render(battleFrame());
    expect(html).toContain("1:40.150");
    expect(html).toContain(">-2.5<");
    expect(html).toContain(">0.0<");
    expect(html).toContain(">+0.8<");
    expect(html).not.toContain("threat");
    expect(css).not.toContain("threat");
  });

  it("has no gap threat setting, and a saved one is dropped on load", () => {
    expect(battleBoxManifest.settings.map((s) => s.key)).not.toContain("gap-threat");
    const loaded = sanitizeInstanceSettings(battleBoxManifest, {
      enabled: true,
      options: { "gap-threat": true, "sector-strips": false },
    });
    expect(loaded.options).not.toHaveProperty("gap-threat");
    expect(loaded.options["sector-strips"]).toBe(false);
    expect(render(battleFrame(), { "gap-threat": true } as never)).not.toContain("threat");
  });

  it("draws a sector strip after the car ahead and after you, coloured by who was faster", () => {
    const html = render(battleFrame());
    expect(html.match(/class="ov-bb-strip"/g)).toHaveLength(2);
    expect(html.match(/ov-bb-sector-label">S\d</g)).toHaveLength(6);
    expect(html).toContain(
      '<div class="ov-bb-sector ov-bb-sector--gain"><span class="ov-bb-sector-label">S1</span><b class="ov-bb-sector-value">-0.14s</b>',
    );
    expect(html).toContain('ov-bb-sector--loss"><span class="ov-bb-sector-label">S2</span>');
    expect(html).toContain(">+0.06s<");
    // No time yet for the car behind in S2.
    expect(html).toContain(
      '<div class="ov-bb-sector"><span class="ov-bb-sector-label">S2</span><b class="ov-bb-sector-value">--</b>',
    );
    const strip = html.indexOf("ov-bb-strip");
    expect(strip).toBeGreaterThan(html.indexOf("M. Castellan"));
    expect(strip).toBeLessThan(html.indexOf("A. Marlow"));
  });

  it("hides the strips with the option off or without sector data", () => {
    expect(render(battleFrame(), { "sector-strips": false })).not.toContain("ov-bb-strip");
    const none = battleFrame({
      standings: (entries) => entries.map((e) => ({ ...e, sectorTimes: null })),
    });
    expect(render(none)).not.toContain("ov-bb-strip");
  });

  it("has no iRating column in LMU", () => {
    expect(render(battleFrame())).toContain("ov-pill--ir");
    const lmu = render(battleFrame({ sim: "lmu" }));
    expect(lmu).not.toContain("ov-pill--ir");
    expect(lmu).not.toContain(">iR<");
  });

  it("shows the flag badge after the name", () => {
    const f = battleFrame();
    const car = f.state.cars.find((c) => c.carIdx === 2);
    if (car === undefined) throw new Error("fixture");
    car.trackSurface = "offTrack";
    const html = render(f);
    expect(html).toContain("ov-badge-flag");
    expect(html.match(/ov-row--yellow/g)).toHaveLength(1);
  });

  it("waits for standings without a frame", () => {
    expect(render(null)).toContain("Waiting for standings");
  });
});

describe("sectorDeltaText", () => {
  it("signs two decimals and appends s", () => {
    expect(sectorDeltaText(-0.14)).toBe("-0.14s");
    expect(sectorDeltaText(0.06)).toBe("+0.06s");
    expect(sectorDeltaText(0)).toBe("0.00s");
    expect(sectorDeltaText(null)).toBe("--");
  });
});

describe("battle box CSS", () => {
  it("sizes text from the theme font size and draws the inset panel border", () => {
    expect(rule(".ov-bb")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".ov-bb::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });

  it("uses only theme tokens and locked colours", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i);
    expect(rule(".ov-bb-sector--gain .ov-bb-sector-value")).toContain("var(--ov-locked-gain)");
    expect(rule(".ov-bb-sector--loss .ov-bb-sector-value")).toContain("var(--ov-locked-loss)");
  });
});
