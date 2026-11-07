import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOMINAL_TABLE_METRICS } from "@overlay/ui/fit";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { applySettingsPatch, defaultInstanceSettings, sanitizeOptionValue } from "../settings";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { fixtureFrame } from "../shared";
import { tableWidthsFor } from "../shared/table-fit";
import { relativeModule } from "./index";
import { relativeManifest } from "./manifest";
import { RelativeOverlay } from "./RelativeOverlay";

const NAMES = ["Max Example", "José María Pérez", "Zofia Świątkowska", "Ada Testova"];

function frame(): TelemetryFrame {
  return fixtureFrame({
    playerCarIdx: 0,
    cars: [
      { carIdx: 0, driverName: NAMES[0], carNumber: "11", position: 4 },
      { carIdx: 1, driverName: NAMES[1], carNumber: "22", position: 3 },
      { carIdx: 2, driverName: NAMES[2], carNumber: "33", position: 5 },
      { carIdx: 3, driverName: NAMES[3], carNumber: "44", position: 6 },
    ],
    gaps: [
      { carIdx: 1, gapS: -1.2, tier: "position" },
      { carIdx: 2, gapS: 0.8, tier: "position" },
      { carIdx: 3, gapS: 1.6, tier: "position" },
    ],
    conditions: { airTempC: 21, trackTempC: 30, wetness: 0 },
    session: { timeRemainingS: 600, timing: "time" },
    flags: { yellow: true },
  });
}

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string | readonly string[]> = {},
): string {
  const base = defaultInstanceSettings(relativeManifest);
  const settings = applySettingsPatch(relativeManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f)}>
      <RelativeOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

describe("relative manifest", () => {
  it("has no overall-position or car-class column", () => {
    const ids = relativeManifest.fields.map((f) => f.id);
    expect(ids).not.toContain("overall-position");
    expect(ids).not.toContain("car-class");
    expect(ids).toContain("gap");
  });

  it("shows the documented columns by default", () => {
    expect(relativeManifest.fields.filter((f) => f.defaultVisible).map((f) => f.id)).toEqual([
      "position",
      "car-number",
      "driver",
      "licence",
      "irating",
      "gap",
    ]);
  });

  it("defaults the window width to the computed fit", () => {
    const widths = tableWidthsFor(
      relativeManifest,
      defaultInstanceSettings(relativeManifest),
      NOMINAL_TABLE_METRICS,
    );
    if (widths === null || widths.fitPx === null) throw new Error("table manifest");
    expect(relativeManifest.defaultSize).toEqual({ width: Math.ceil(widths.fitPx), height: 300 });
    expect(relativeManifest.defaultSize.width).toBeGreaterThan(420);
    expect(relativeManifest.defaultSize.width).toBeLessThan(440);
  });

  it("shows air, track, wetness and wind in the header by default", () => {
    const field = relativeManifest.settings.find((f) => f.key === "header-fields");
    expect(field?.default).toEqual(["air-temp", "track-temp", "wetness", "wind"]);
    expect(render(frame())).toContain(">Wind<");
  });

  it("is a table overlay at 10 Hz and the module uses it", () => {
    expect(relativeManifest).toMatchObject({ table: true, rateHz: 10, defaultEnabled: true });
    expect(relativeModule.manifest).toBe(relativeManifest);
  });

  it("sanitises every option default to itself and limits multi fields to 5", () => {
    const settings = defaultInstanceSettings(relativeManifest);
    for (const field of relativeManifest.settings) {
      expect(sanitizeOptionValue(field, field.default)).toEqual(field.default);
      expect(settings.options[field.key]).toEqual(field.default);
    }
    const header = relativeManifest.settings.find((f) => f.key === "header-fields");
    if (header === undefined) throw new Error("missing header-fields");
    const six = ["sof", "incidents", "air-temp", "track-temp", "wetness", "humidity"];
    expect(sanitizeOptionValue(header, six)).toHaveLength(5);
  });

  it("clamps the driver counts to 0..8", () => {
    const field = relativeManifest.settings.find((f) => f.key === "drivers-ahead");
    if (field === undefined) throw new Error("missing drivers-ahead");
    expect(sanitizeOptionValue(field, 12)).toBe(8);
    expect(sanitizeOptionValue(field, -3)).toBe(0);
  });
});

describe("RelativeOverlay", () => {
  it("renders rows in order with invented names and the own-row class on the focus car", () => {
    const html = render(frame());
    const order = ["Z. Świątkowska", "A. Testova"].map((n) => html.indexOf(n));
    expect(html.indexOf("J. Pérez")).toBeGreaterThan(-1);
    expect(html.indexOf("J. Pérez")).toBeLessThan(html.indexOf("M. Example"));
    expect(html.indexOf("M. Example")).toBeLessThan(order[0] ?? -1);
    expect(order[0]).toBeLessThan(order[1] ?? -1);
    expect(html).toContain("ov-row--own");
  });

  it("draws a yellow row for an off-track car", () => {
    const f = frame();
    expect(render(f)).not.toContain("ov-row--yellow");
    const car = f.state.cars.find((c) => c.carIdx === 3);
    if (car === undefined) throw new Error("fixture");
    car.trackSurface = "offTrack";
    expect(render(f).match(/ov-row--yellow/g)).toHaveLength(1);
  });

  it("prints signed gaps and colours only the cars behind", () => {
    const html = render(frame());
    expect(html).toContain("-1.2");
    expect(html).toContain("+0.8");
    expect(html).toContain('<span class="ov-rel-threat--red">+0.8</span>');
    expect(html).toContain('<span class="ov-rel-threat--yellow">+1.6</span>');
    expect(html).not.toContain('ov-rel-threat--red">-1.2');
    expect(render(frame(), { "gap-threat": false })).not.toContain("ov-rel-threat");
  });

  it("makes the threat colours bold", () => {
    const css = readFileSync(join(__dirname, "relative.css"), "utf8");
    for (const level of ["red", "yellow"]) {
      const block = css.match(new RegExp(`\\.ov-rel-threat--${level} \\{[^}]*\\}`));
      expect(block?.[0]).toContain("font-weight: 700");
    }
  });

  it("labels the gap column Rel", () => {
    const html = render(frame(), { "row-labels": true });
    expect(html).toContain(">Rel<");
    expect(html).not.toContain(">Gap<");
  });

  describe("iRating change option", () => {
    const f = fixtureFrame({
      playerCarIdx: 0,
      cars: [
        { carIdx: 0, driverName: NAMES[0], carNumber: "11", position: 4, iRating: 2400 },
        { carIdx: 1, driverName: NAMES[1], carNumber: "22", position: 3, iRating: 2000 },
      ],
      gaps: [{ carIdx: 1, gapS: -1.2, tier: "position" }],
      standings: [
        { carIdx: 0, iRatingChange: 11 },
        { carIdx: 1, iRatingChange: 25 },
      ],
    });

    it("is an iRacing-only toggle in Drivers, off by default", () => {
      const field = relativeManifest.settings.find((s) => s.key === "irating-change");
      expect(field).toMatchObject({
        kind: "toggle",
        section: "Drivers",
        default: false,
        sims: ["iracing"],
      });
    });

    it("off: narrow fixed pill without the change, even when the entry has one", () => {
      const html = render(f);
      expect(html).toContain(">2.0k<");
      expect(html).toContain("ov-pill--ir-narrow");
      expect(html).not.toContain("ov-pill--ir-wide");
      expect(html).not.toContain("ov-ir-delta");
    });

    it("on: wide fixed pill with the change", () => {
      const html = render(f, { "irating-change": true });
      expect(html).toContain("ov-pill--ir-wide");
      expect(html).not.toContain("ov-pill--ir-narrow");
      expect(html).toContain("\u25B2</span>25");
      expect(html).toContain("\u25B2</span>11");
    });

    it("the fit width follows the toggle", () => {
      const fit = (on: boolean): number => {
        const settings = applySettingsPatch(
          relativeManifest,
          defaultInstanceSettings(relativeManifest),
          { options: { "irating-change": on } },
        );
        const widths = tableWidthsFor(relativeManifest, settings, NOMINAL_TABLE_METRICS);
        if (widths === null || widths.fitPx === null) throw new Error("table manifest");
        return widths.fitPx;
      };
      expect(fit(true)).toBeGreaterThan(fit(false));
    });
  });

  it("draws an OFF badge after the name of an off-track car, a PIT badge for pit road", () => {
    const f = frame();
    const off = f.state.cars.find((c) => c.carIdx === 3);
    const pit = f.state.cars.find((c) => c.carIdx === 2);
    if (off === undefined || pit === undefined) throw new Error("fixture");
    off.trackSurface = "offTrack";
    pit.onPitRoad = true;
    const html = render(f);
    expect(html).toContain("ov-badge-flag--off");
    expect(html).toContain(">PIT<");
  });

  it("writes the data-hidden-columns attribute (empty without a measurement)", () => {
    expect(render(frame())).toContain('data-hidden-columns=""');
  });

  it("toggles the header and footer strips", () => {
    const on = render(frame());
    expect(on).toContain(">Air<");
    expect(on).toContain("Time left");
    const off = render(frame(), { "weather-header": false, "session-footer": false });
    expect(off).not.toContain(">Air<");
    expect(off).not.toContain("Time left");
  });

  it("toggles row labels", () => {
    expect(render(frame())).toContain("ov-row--header");
    expect(render(frame(), { "row-labels": false })).not.toContain("ov-row--header");
  });

  it("draws the flag border only when on", () => {
    expect(render(frame())).not.toContain("inset 0 0 0 3px");
    expect(render(frame(), { "flag-border": true })).toContain(
      "box-shadow:inset 0 0 0 3px var(--ov-locked-flag-yellow)",
    );
  });

  it("says No cars nearby when there is no focus car or no frame", () => {
    expect(render(null)).toContain("No cars nearby");
    const noFocus = fixtureFrame({ playerCarIdx: null, cars: [{ carIdx: 1 }] });
    expect(render(noFocus)).toContain("No cars nearby");
  });

  it("leaves out iRacing-only columns in LMU", () => {
    const headers = (f: TelemetryFrame) =>
      render(f, { "row-labels": true }).match(/role="columnheader"/g)?.length ?? 0;
    const iracing = frame();
    const lmu = { ...iracing, state: { ...iracing.state, sim: "lmu" as const } } as TelemetryFrame;
    expect(headers(iracing) - headers(lmu)).toBe(2);
  });
});
