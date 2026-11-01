import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../../../shared/app-settings-types";
import { GeneralForm, startWithWindowsAvailable } from "./GeneralPage";
import { PerformanceForm } from "./PerformancePage";

const noop = () => undefined;

function withGeneral(patch: Partial<AppSettings["general"]>): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, general: { ...DEFAULT_APP_SETTINGS.general, ...patch } };
}

describe("startWithWindowsAvailable", () => {
  it("needs a non-local build on Windows", () => {
    expect(startWithWindowsAvailable(true, "Win32")).toBe(true);
    expect(startWithWindowsAvailable(false, "Win32")).toBe(false);
    expect(startWithWindowsAvailable(true, "Linux x86_64")).toBe(false);
  });
});

describe("GeneralForm", () => {
  const render = (settings: AppSettings, canAutostart = true) =>
    renderToStaticMarkup(
      <GeneralForm settings={settings} update={noop} canAutostart={canAutostart} />,
    );

  it("shows the labels and help text", () => {
    const html = render(DEFAULT_APP_SETTINGS);
    for (const text of [
      "Metric",
      "Imperial",
      "24 h",
      "12 h",
      "Keep car speed in mph",
      "Hide overlays when no sim is running",
      "UI scale",
      "150 %",
      "Scales this settings window only.",
      "Start hidden when Windows starts",
      "When I close the window",
      "Keep running in the tray",
      "Shows the Developer page, test data sources (Replay file, Mock) and developer overlays.",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("disables the mph toggle with imperial units", () => {
    expect(render(withGeneral({ units: "imperial" }))).toContain(
      'aria-label="Keep car speed in mph" disabled=""',
    );
    expect(render(withGeneral({ units: "metric" }))).not.toContain(
      'aria-label="Keep car speed in mph" disabled=""',
    );
  });

  it("disables Start with Windows when unavailable", () => {
    expect(render(DEFAULT_APP_SETTINGS, false)).toContain(
      "Only available in the installed Windows app.",
    );
  });

  it("has no Data source row (the game choice lives in the top bar)", () => {
    const html = render(DEFAULT_APP_SETTINGS);
    expect(html).not.toContain("Data source");
    expect(html).not.toContain("<select");
  });

  it("marks the current close action", () => {
    expect(render(withGeneral({ closeAction: "quit" }))).toMatch(/aria-pressed="true"[^>]*>Quit</);
    expect(render(DEFAULT_APP_SETTINGS)).toMatch(
      /aria-pressed="true"[^>]*>Keep running in the tray</,
    );
  });

  it("disables start hidden when Start with Windows is off", () => {
    expect(render(withGeneral({ startWithWindows: false }))).toContain(
      'aria-label="Start hidden when Windows starts" disabled=""',
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
