import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { applySettingsPatch, defaultInstanceSettings, sanitizeOptionValue } from "../settings";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { fixtureFrame } from "../shared";
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
      "last-lap",
    ]);
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

  it("prints signed gaps and colours only the cars behind", () => {
    const html = render(frame());
    expect(html).toContain("-1.2");
    expect(html).toContain("+0.8");
    expect(html).toContain('<span class="ov-rel-threat--red">+0.8</span>');
    expect(html).toContain('<span class="ov-rel-threat--yellow">+1.6</span>');
    expect(html).not.toContain('ov-rel-threat--red">-1.2');
    expect(render(frame(), { "gap-threat": false })).not.toContain("ov-rel-threat");
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
    expect(render(frame())).not.toContain("ov-row--header");
    expect(render(frame(), { "row-labels": true })).toContain("ov-row--header");
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
