import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { webviewManifest } from "./manifest";
import {
  WEBVIEW_KEYS as K,
  WEBVIEW_OVERLAY_ID,
  refreshIntervalMs,
  webviewOptions,
} from "./options";
import { NO_URL_TEXT, PREVIEW_TEXT, WebviewOverlay, pageRectOf, sameRect } from "./WebviewOverlay";

function settingsWith(options: Record<string, boolean | number | string> = {}, titleBar = false) {
  const base = defaultInstanceSettings(webviewManifest);
  return applySettingsPatch(webviewManifest, base, { options, common: { showTitleBar: titleBar } });
}

function render(
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
  titleBar = false,
): string {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(null, runtime)}>
      <WebviewOverlay settings={settingsWith(options, titleBar)} />
    </OverlayRuntimeContext.Provider>,
  );
}

const URL = "http://127.0.0.1:8888/Dash/Endurance";
const host: Partial<OverlayRuntime> = { reportPageRect: () => {} };

describe("webview manifest", () => {
  it("is a 400 x 260 overlay for both sims, off by default, and registered", () => {
    const m = webviewManifest;
    expect(m.id).toBe(WEBVIEW_OVERLAY_ID);
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.defaultSize).toEqual({ width: 400, height: 260 });
    expect(m.defaultEnabled).toBe(false);
    expect(m.table).toBe(false);
    expect(m.needsTelemetry).toBe(false);
    expect(m.editTitleBarInFlow).toBe(true);
    expect(manifestById("webview")).toBe(m);
    expect(moduleById("webview")?.Component).toBe(WebviewOverlay);
  });

  it("starts with no page, transparent, without scrollbars, at 100 %, no refresh, no interaction", () => {
    const o = webviewOptions(defaultInstanceSettings(webviewManifest));
    expect(o).toEqual({
      url: null,
      urlText: "",
      transparent: true,
      hideScrollbars: true,
      zoomPct: 100,
      refreshMs: null,
      interactive: false,
      customCss: "",
    });
  });

  it("offers zoom 50-200 % and the refresh intervals", () => {
    const zoom = webviewManifest.settings.find((s) => s.key === K.zoom);
    expect(zoom).toMatchObject({ kind: "number", min: 50, max: 200, unit: "%" });
    const refresh = webviewManifest.settings.find((s) => s.key === K.refresh);
    expect(refresh?.kind === "select" && refresh.options.map((o) => o.value)).toEqual([
      "off",
      "30s",
      "1m",
      "5m",
      "15m",
    ]);
  });

  it("only stores http(s) addresses", () => {
    expect(settingsWith({ [K.url]: URL }).options[K.url]).toBe(URL);
    expect(settingsWith({ [K.url]: "file:///C:/x.html" }).options[K.url]).toBe("");
    expect(settingsWith({ [K.url]: "javascript:alert(1)" }).options[K.url]).toBe("");
  });
});

describe("webviewOptions", () => {
  it("reads typed values with safe fallbacks", () => {
    const o = webviewOptions({
      options: {
        [K.url]: ` ${URL} `,
        [K.transparent]: false,
        [K.hideScrollbars]: false,
        [K.zoom]: 400,
        [K.refresh]: "5m",
        [K.interactive]: true,
        [K.customCss]: "body{color:red}",
      },
    });
    expect(o).toMatchObject({
      url: URL,
      urlText: URL,
      transparent: false,
      hideScrollbars: false,
      zoomPct: 200,
      refreshMs: 300_000,
      interactive: true,
      customCss: "body{color:red}",
    });
    expect(webviewOptions({ options: { [K.url]: "file:///x" } }).url).toBeNull();
    expect(webviewOptions({ options: { [K.zoom]: Number.NaN } }).zoomPct).toBe(100);
  });

  it("maps refresh choices to milliseconds", () => {
    expect(refreshIntervalMs("off")).toBeNull();
    expect(refreshIntervalMs("30s")).toBe(30_000);
    expect(refreshIntervalMs("1m")).toBe(60_000);
    expect(refreshIntervalMs("15m")).toBe(900_000);
    expect(refreshIntervalMs("2h")).toBeNull();
    expect(refreshIntervalMs(5)).toBeNull();
  });
});

describe("WebviewOverlay", () => {
  it("shows nothing while driving without a page", () => {
    expect(render({}, host)).toBe("");
    expect(render({}, host, true)).toBe("");
  });

  it("asks for an address in edit mode without one", () => {
    const html = render({}, { ...host, editing: true });
    expect(html).toContain(NO_URL_TEXT);
    expect(html).toContain("Not set");
  });

  it("is only the page area while driving", () => {
    const html = render({ [K.url]: URL }, host);
    expect(html).toContain('class="wv-page"');
    expect(html).not.toContain("wv-bar");
    expect(html).not.toContain("wv-strip");
    expect(html).not.toContain("wv-placeholder");
  });

  it("shows the address bar while editing or with the title bar on", () => {
    const editing = render({ [K.url]: URL }, { ...host, editing: true });
    expect(editing).toContain('<span class="wv-bar-label">URL</span>');
    expect(editing).toContain(URL);
    const titled = render({ [K.url]: URL }, host, true);
    expect(titled).toContain("wv-bar-url");
    expect(titled).not.toContain("wv-strip");
  });

  it("lists the page settings along the bottom while editing", () => {
    const html = render({ [K.url]: URL, [K.hideScrollbars]: false }, { ...host, editing: true });
    expect(html).toContain("Transparent background: <b>ON</b>");
    expect(html).toContain("Hide scrollbars: <b>OFF</b>");
  });

  it("shows the zoom in the bar when it is not 100 %", () => {
    expect(render({ [K.url]: URL, [K.zoom]: 150 }, { ...host, editing: true })).toContain(
      '<span class="wv-badge">150%</span>',
    );
    expect(render({ [K.url]: URL }, { ...host, editing: true })).not.toContain("wv-badge");
  });

  it("never loads the page itself: the settings preview shows a note", () => {
    const html = render({ [K.url]: URL }, { editing: true });
    expect(html).toContain(PREVIEW_TEXT);
    expect(html).not.toMatch(/<iframe|<webview|<object|<embed/);
    expect(render({ [K.url]: URL }, host)).not.toMatch(/<iframe|<webview|<object|<embed/);
  });
});

describe("page rect helpers", () => {
  it("rounds the box to whole px and never goes negative in size", () => {
    expect(pageRectOf({ left: 0.4, top: 20.6, width: 399.5, height: -3 })).toEqual({
      x: 0,
      y: 21,
      width: 400,
      height: 0,
    });
  });

  it("compares rects", () => {
    const a = { x: 0, y: 20, width: 400, height: 220 };
    expect(sameRect(a, { ...a })).toBe(true);
    expect(sameRect(a, { ...a, height: 221 })).toBe(false);
    expect(sameRect(null, null)).toBe(true);
    expect(sameRect(a, null)).toBe(false);
  });
});

describe("webview css", () => {
  const css = readFileSync(join(import.meta.dirname, "webview.css"), "utf8");

  it("uses theme tokens only and em sizes for text", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(css).toContain("font-size: var(--ov-font-size, 14px)");
  });

  it("paints nothing under the page area", () => {
    const page = /\.wv-page \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(page).not.toContain("background");
  });
});
