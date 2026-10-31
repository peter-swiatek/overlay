import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../../shared/app-settings-types";
import { GeneralForm, sourceOptions, startWithWindowsAvailable } from "./GeneralPage";
import { PerformanceForm } from "./PerformancePage";

const noop = () => undefined;

function withGeneral(patch: Partial<AppSettings["general"]>): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, general: { ...DEFAULT_APP_SETTINGS.general, ...patch } };
}

describe("sourceOptions", () => {
  it("lists only Auto, iRacing and LMU for the normal sources", () => {
    for (const source of ["auto", "iracing", "lmu"] as const) {
      expect(sourceOptions(source).map((o) => o.value)).toEqual(["auto", "iracing", "lmu"]);
    }
  });

  it("adds Replay and Mock as an extra entry so the control never lies", () => {
    expect(sourceOptions("replay").at(-1)).toEqual({
      value: "replay",
      label: "Replay (developer)",
    });
    expect(sourceOptions("mock").at(-1)).toEqual({ value: "mock", label: "Mock (developer)" });
  });
});

describe("startWithWindowsAvailable", () => {
  it("needs a non-local build on Windows", () => {
    expect(startWithWindowsAvailable("release", "Win32")).toBe(true);
    expect(startWithWindowsAvailable("local", "Win32")).toBe(false);
    expect(startWithWindowsAvailable("release", "Linux x86_64")).toBe(false);
  });
});

describe("GeneralForm", () => {
  const render = (settings: AppSettings, source: "auto" | "mock", canAutostart = true) =>
    renderToStaticMarkup(
      <GeneralForm
        settings={settings}
        update={noop}
        source={{ source, replayPath: null }}
        canAutostart={canAutostart}
        onSource={noop}
      />,
    );

  it("shows the labels and help text", () => {
    const html = render(DEFAULT_APP_SETTINGS, "auto");
    for (const text of [
      "Metric",
      "Imperial",
      "24 h",
      "12 h",
      "Keep car speed in mph",
      "Hide overlays when no sim is running",
      "UI scale",
      "150 %",
      "Shows the Developer page, test data sources (Replay file, Mock) and developer overlays.",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("disables the mph toggle with imperial units", () => {
    expect(render(withGeneral({ units: "imperial" }), "auto")).toContain(
      'aria-label="Keep car speed in mph" disabled=""',
    );
    expect(render(withGeneral({ units: "metric" }), "auto")).not.toContain(
      'aria-label="Keep car speed in mph" disabled=""',
    );
  });

  it("disables Start with Windows when unavailable", () => {
    expect(render(DEFAULT_APP_SETTINGS, "auto", false)).toContain(
      "Only available in the installed Windows app.",
    );
  });

  it("selects the Mock entry when the source is mock", () => {
    expect(render(DEFAULT_APP_SETTINGS, "mock")).toContain(
      '<option value="mock" selected="">Mock (developer)</option>',
    );
  });
});

describe("PerformanceForm", () => {
  it("renders the rate, live positions and effects settings", () => {
    const html = renderToStaticMarkup(
      <PerformanceForm
        settings={{
          ...DEFAULT_APP_SETTINGS,
          performance: { telemetryRateHz: 30, livePositions: false, reduceVisualEffects: true },
        }}
        set={noop}
      />,
    );
    expect(html).toContain('aria-pressed="true">30 Hz');
    expect(html).toContain('aria-pressed="false">60 Hz');
    expect(html).toContain("30 Hz roughly halves overlay CPU");
    expect(html).toContain("Live position tracking");
    expect(html).toContain("No fades or animations.");
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });
});
