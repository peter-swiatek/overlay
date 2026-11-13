import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { NOMINAL_TABLE_METRICS } from "@overlay/ui/fit";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { tableWidthsFor } from "../shared/table-fit";
import { OvertakeAlertOverlay } from "./OvertakeAlertOverlay";
import { overtakeAlertManifest } from "./manifest";
import { WINDOW_DEFAULT_S, WINDOW_MAX_S, WINDOW_MIN_S } from "./view";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(overtakeAlertManifest);
  const settings = applySettingsPatch(overtakeAlertManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <OvertakeAlertOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

/** A GT3 player with two Hypercars behind at `gaps` seconds. */
function frame(gaps: [number, number], sim: "iracing" | "lmu" = "iracing"): TelemetryFrame {
  const hyper = { classId: "2", className: "Hypercar", classColour: "#ff5888", license: "A 3.00" };
  return fixtureFrame({
    sim,
    cars: [
      { carIdx: 0, classId: "1", className: "GT3", classColour: "#ffda59", bestLapS: 100 },
      { carIdx: 1, ...hyper, carNumber: "10", driverName: "Ada Testova", iRating: 2500 },
      { carIdx: 2, ...hyper, carNumber: "15", driverName: "Ben Sample", iRating: 2700 },
    ],
    playerCarIdx: 0,
    gaps: [
      { carIdx: 1, gapS: gaps[0], tier: "position" },
      { carIdx: 2, gapS: gaps[1], tier: "position" },
    ],
    standings: [
      { carIdx: 0, classPosition: 4 },
      { carIdx: 1, classPosition: 2 },
      { carIdx: 2, classPosition: 3 },
    ],
    standingsInfo: { classBestLapS: { "1": 100, "2": 86 } },
  });
}

const cells = (html: string): number => html.match(/role="cell"/g)?.length ?? 0;

describe("overtake alert manifest", () => {
  it("is offered for both sims, off by default, 80 high, and registered", () => {
    const m = overtakeAlertManifest;
    expect(m.id).toBe("overtake-alert");
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.defaultSize.height).toBe(80);
    expect(m.table).toBe(true);
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(manifestById("overtake-alert")).toBe(m);
    expect(moduleById("overtake-alert")?.Component).toBe(OvertakeAlertOverlay);
  });

  it("shows the Relative's row pieces: position, car, driver, licence, iRating, gap", () => {
    const visible = overtakeAlertManifest.fields.filter((f) => f.defaultVisible).map((f) => f.id);
    expect(visible).toEqual(["position", "car-number", "driver", "licence", "irating", "gap"]);
  });

  it("has the alert settings with their defaults", () => {
    const options = defaultInstanceSettings(overtakeAlertManifest).options;
    expect(options).toEqual({
      "column-width": "auto",
      "width-fine-tune": 100,
      "name-display": "driver",
      "name-format": "f-last",
      "window-seconds": WINDOW_DEFAULT_S,
      "max-rows": 2,
      "same-class": false,
      "irating-change": false,
    });
    const window = overtakeAlertManifest.settings.find((s) => s.key === "window-seconds");
    expect(window).toMatchObject({ min: WINDOW_MIN_S, max: WINDOW_MAX_S, unit: "s" });
  });

  it("defaults the window width to the computed fit", () => {
    const widths = tableWidthsFor(
      overtakeAlertManifest,
      defaultInstanceSettings(overtakeAlertManifest),
      NOMINAL_TABLE_METRICS,
    );
    if (widths === null || widths.fitPx === null) throw new Error("table manifest");
    expect(overtakeAlertManifest.defaultSize.width).toBe(Math.ceil(widths.fitPx));
  });
});

describe("OvertakeAlertOverlay", () => {
  it("draws one row per car, closest first, with the Relative's pieces and the gap", () => {
    const html = render(frame([3.8, 1.2]));
    expect(html).toContain('class="ov-oa"');
    expect(html.indexOf(">B. Sample<")).toBeLessThan(html.indexOf(">A. Testova<"));
    expect(cells(html)).toBe(12);
    expect(html).toContain("ov-cell--pos");
    expect(html).toContain("--class-color:#ff5888");
    expect(html).toContain("ov-pill--ir");
    expect(html).toContain(">2.5k<");
    expect(html).toContain("ov-pill--lic");
    // Car numbers without "#".
    expect(html).toMatch(/>15</);
    expect(html).not.toContain("#15");
    expect(html).toContain('<span class="ov-oa-gap ov-oa-gap--close">+1.2s</span>');
    expect(html).toContain('<span class="ov-oa-gap ov-oa-gap--far">+3.8s</span>');
    // Header row off; placed by its gap.
    expect(html).not.toContain("columnheader");
    expect(html).toContain("--oa-top:min(calc(100cqh - 2 * var(--ov-row-height, 24px))");
  });

  it("follows the max rows and name format settings", () => {
    const html = render(frame([3.8, 1.2]), { "max-rows": 1, "name-format": "last" });
    expect(cells(html)).toBe(6);
    expect(html).toContain(">Sample<");
    expect(html).not.toContain("Testova");
  });

  it("hides the licence and iRating pills in LMU", () => {
    const html = render(frame([3.8, 1.2], "lmu"));
    expect(cells(html)).toBe(8);
    expect(html).not.toContain("ov-pill--ir");
    expect(html).not.toContain("ov-pill--lic");
  });

  it("draws nothing when no car qualifies or without a frame", () => {
    for (const html of [render(frame([6, 7])), render(frame([-1, 7])), render(null)]) {
      expect(html).toContain('class="ov-oa"');
      expect(html).not.toContain("ov-table");
    }
  });

  it("shows the design's two rows while editing with no car to show", () => {
    for (const f of [null, frame([6, 7])]) {
      const html = render(f, {}, { editing: true });
      expect(cells(html)).toBe(12);
      expect(html).toContain(">N. Quill<");
      expect(html).toContain(">K. Holm<");
      expect(html).toContain(">+1.2s<");
      expect(html).toContain(">+3.8s<");
    }
    expect(render(frame([3.8, 1.2]), {}, { editing: true })).not.toContain("Quill");
  });
});

describe("Overtake Alert CSS", () => {
  const css = readFileSync(join(__dirname, "overtake-alert.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size on a transparent, size-contained root", () => {
    expect(rule(".ov-oa")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".ov-oa")).toContain("background: transparent;");
    expect(rule(".ov-oa")).toContain("container-type: size;");
  });

  it("takes colours only from tokens and locked colours: loss red close, flag yellow further", () => {
    expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? []).toEqual([]);
    expect(rule(".ov-oa-gap--close")).toContain("var(--ov-locked-loss)");
    expect(rule(".ov-oa-gap--far")).toContain("var(--ov-locked-flag-yellow)");
  });

  it("sizes in em, apart from 1 px hairlines", () => {
    expect(css.replace(/14px\)|-?1px/g, "")).not.toMatch(/\d+px/);
  });
});
