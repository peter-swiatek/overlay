import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUILD_INFO } from "../../../shared/build-info";
import type { AppInfo, DisplaySettings } from "../../../shared/types";
import { DisplayView, needsRestart } from "./DisplayPage";

const OFF: DisplaySettings = {
  disableHardwareAcceleration: false,
  disableDirectComposition: false,
  opacityWorkaround: false,
  disableNativeOcclusion: false,
};
const info = (display: Partial<DisplaySettings>, safeMode = false): AppInfo => ({
  version: "0.0.0",
  build: BUILD_INFO,
  display: { ...OFF, ...display },
  effective: OFF,
  safeMode,
});
const render = (i: AppInfo | undefined) =>
  renderToStaticMarkup(
    <DisplayView info={i} onToggle={() => undefined} onRestart={() => undefined} />,
  );

describe("needsRestart", () => {
  it("compares stored with effective", () => {
    expect(needsRestart(info({}))).toBe(false);
    expect(needsRestart(info({ disableNativeOcclusion: true }))).toBe(true);
  });
});

describe("DisplayView", () => {
  it("lists the four options with restart badges and the fullscreen hint", () => {
    const html = render(info({}));
    expect(html).toContain("Disable hardware acceleration");
    expect(html).toContain("Disable DirectComposition");
    expect(html).toContain("Transparency fix (window opacity 0.99)");
    expect(html).toContain("Disable native window occlusion");
    expect(html.match(/<em>restart to apply<\/em>/g)).toHaveLength(4);
    expect(html).toContain("exclusive fullscreen hides every overlay app");
    expect(html).not.toContain("Restart now");
  });

  it("shows the banner and Restart now while a change is pending", () => {
    const html = render(info({ opacityWorkaround: true }));
    expect(html).toContain("Restart to apply your changes");
    expect(html).toContain("Restart now");
  });

  it("shows the safe-mode note", () => {
    expect(render(info({}, true))).toContain("--safe-mode");
    expect(render(info({}))).not.toContain("--safe-mode");
  });

  it("renders before the info has loaded", () => {
    expect(render(undefined)).not.toContain("Restart now");
  });
});
