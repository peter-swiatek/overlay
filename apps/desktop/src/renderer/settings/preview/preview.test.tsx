import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { moduleById, staticRuntime } from "@overlay/overlays";
import { applySettingsPatch, defaultInstanceSettings } from "@overlay/overlays/settings";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import { GRAPHITE } from "@overlay/theme";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { OverlayErrorBoundary } from "../../overlay/ErrorBoundary";
import { fallbackFrame } from "./fallback-frame";
import { PreviewStage } from "./PreviewStage";
import {
  FALLBACK_CH_PX,
  captionText,
  computeMeasure,
  bootFeed,
  createFeedDriver,
  createFrameStore,
  createLazy,
  createPreviewRuntime,
  fitScale,
  parseHiddenColumns,
  previewPaused,
  previewSize,
  toOverlayPx,
  usableFrame,
  zoomRatio,
} from "./preview-runtime";

function mod(id: string) {
  const m = moduleById(id);
  if (!m) throw new Error(`no module ${id}`);
  return m;
}

function render(
  id: string,
  patch: unknown = {},
  frame: TelemetryFrame = fallbackFrame(),
  fit = 1,
): string {
  const module = mod(id);
  const settings: OverlayInstanceSettings = applySettingsPatch(
    module.manifest,
    defaultInstanceSettings(module.manifest),
    patch,
  );
  const base = staticRuntime(frame);
  const runtime = createPreviewRuntime(base.useTelemetry, {
    prefs: base.prefs,
    livePositions: true,
    reduceVisualEffects: false,
    combinedLicencePill: false,
  });
  return renderToStaticMarkup(
    <PreviewStage
      module={module}
      settings={settings}
      size={previewSize(null, module.manifest)}
      fit={fit}
      shellZoom={1}
      runtime={runtime}
      theme={GRAPHITE}
    />,
  );
}

const cells = (html: string): number => html.match(/role="cell"/g)?.length ?? 0;

describe("PreviewStage with the real overlays", () => {
  it("renders the Leaderboard on demo data, ignoring the Hidden rules", () => {
    const html = render("leaderboard", { common: { hideInGarage: true, hideOffTrack: true } });
    expect(html).toContain("M. Example");
    expect(html).toContain("ov-table");
  });

  it("renders Relative and Fuel", () => {
    expect(render("relative")).toContain("ov-rel");
    expect(render("fuel")).toContain("fuel-");
  });

  it("changes the output when a column is hidden", () => {
    const module = mod("leaderboard");
    const fields = defaultInstanceSettings(module.manifest).common.fields;
    const target = fields.find((f) => f.visible && f.id !== "driver");
    expect(target).toBeDefined();
    const before = render("leaderboard");
    const after = render("leaderboard", {
      common: { fields: fields.map((f) => (f.id === target?.id ? { ...f, visible: false } : f)) },
    });
    expect(after).not.toBe(before);
    expect(cells(after)).toBeLessThan(cells(before));
  });

  it("changes the output when Fuel goes horizontal", () => {
    expect(render("fuel", { options: { layout: "horizontal" } })).not.toBe(render("fuel"));
  });

  it("applies the overlay scale and the fit transform", () => {
    const html = render("leaderboard", { common: { scalePct: 150 } }, fallbackFrame(), 0.5);
    expect(html).toContain("zoom:1.5");
    expect(html).toContain("scale(0.5)");
  });

  it("shows the error box, not a blank pane, when an overlay throws", () => {
    const boundary = new OverlayErrorBoundary({ resetKey: 1, name: "x", children: null });
    expect(OverlayErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    boundary.state = { failed: true };
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toContain("Overlay error");
  });
});

describe("fit and sizes", () => {
  it("fits by the tighter side and never enlarges", () => {
    expect(fitScale({ width: 280, height: 1000 }, { width: 560, height: 440 })).toBe(0.5);
    expect(fitScale({ width: 1000, height: 220 }, { width: 560, height: 440 })).toBe(0.5);
    expect(fitScale({ width: 2000, height: 2000 }, { width: 560, height: 440 })).toBe(1);
  });

  it("is safe on empty boxes", () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 560, height: 440 })).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });

  it("uses the real size when known, else the manifest default", () => {
    const m = mod("fuel").manifest;
    expect(previewSize({ width: 412, height: 236, scalePct: 120 }, m)).toEqual({
      width: 412,
      height: 236,
      scalePct: 120,
    });
    expect(previewSize(null, m)).toEqual({ ...m.defaultSize, scalePct: 100 });
  });

  it("words the caption", () => {
    expect(captionText({ width: 412, height: 236 })).toBe(
      "Preview with demo data. 412 × 236 on screen.",
    );
  });

  it("reads the shell zoom from drawn vs layout width", () => {
    expect(zoomRatio(1250, 1000)).toBe(1.25);
    expect(zoomRatio(0, 0)).toBe(1);
  });
});

describe("onMeasure numbers", () => {
  it("reports table width and ch in the overlay's own px", () => {
    // Drawn at fit 0.5 and 150 % scale: the table is 600 px wide in its own space.
    expect(
      computeMeasure({ drawnTableWidth: 450, drawnProbeWidth: 52.5, fit: 0.5, scalePct: 150 }),
    ).toEqual({ tableWidthPx: 600, chPx: 7 });
    expect(toOverlayPx(450, 0.5, 150)).toBe(600);
  });

  it("gives 0 for no table and the fallback ch before a probe exists", () => {
    expect(
      computeMeasure({ drawnTableWidth: 0, drawnProbeWidth: 0, fit: 1, scalePct: 100 }),
    ).toEqual({ tableWidthPx: 0, chPx: FALLBACK_CH_PX });
  });
});

describe("hidden columns attribute", () => {
  it("splits on whitespace and is empty when absent", () => {
    expect(parseHiddenColumns("irating  last-lap\nlicence")).toEqual([
      "irating",
      "last-lap",
      "licence",
    ]);
    expect(parseHiddenColumns("")).toEqual([]);
    expect(parseHiddenColumns(null)).toEqual([]);
    expect(parseHiddenColumns(undefined)).toEqual([]);
  });
});

describe("demo feed", () => {
  it("falls back until the feed is live", () => {
    const fb = fallbackFrame();
    expect(usableFrame(null, fb)).toBe(fb);
    expect(usableFrame({ ...fb, status: "waiting" }, fb)).toBe(fb);
    const live = { ...fb, seq: 9 };
    expect(usableFrame(live, fb)).toBe(live);
  });

  it("pauses when hidden or minimised", () => {
    expect(previewPaused({ visibility: "visible", minimised: false })).toBe(false);
    expect(previewPaused({ visibility: "hidden", minimised: false })).toBe(true);
    expect(previewPaused({ visibility: "visible", minimised: true })).toBe(true);
  });

  it("steps at 10 Hz and stops cleanly", () => {
    const fb = fallbackFrame();
    const store = createFrameStore(fb);
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.latest().seq));
    const timer: { tick: (() => void) | null; period: number } = { tick: null, period: 0 };
    const steps: number[] = [];
    const driver = createFeedDriver({
      next: (dt) => {
        steps.push(dt);
        return { ...fb, seq: steps.length + 1 };
      },
      onFrame: (f) => store.set(f),
      timers: {
        setInterval: (fn, ms) => {
          timer.tick = fn;
          timer.period = ms;
          return 1;
        },
        clearInterval: () => {
          timer.tick = null;
        },
      },
    });
    driver.start();
    driver.start();
    expect(timer.period).toBe(100);
    timer.tick?.();
    timer.tick?.();
    expect(steps).toEqual([0.1, 0.1]);
    expect(seen).toEqual([2, 3]);
    driver.stop();
    expect(timer.tick).toBeNull();
  });
});

describe("feed boot", () => {
  it("starts the driver once the feed exists, unless paused", () => {
    const starts: string[] = [];
    const driver = { start: () => void starts.push("start") };
    expect(
      bootFeed(
        () => "feed",
        driver,
        false,
        () => undefined,
      ),
    ).toBe("feed");
    expect(
      bootFeed(
        () => "feed",
        driver,
        true,
        () => undefined,
      ),
    ).toBe("feed");
    expect(starts).toEqual(["start"]);
  });

  it("starts nothing and reports when the feed cannot be built", () => {
    const starts: string[] = [];
    const errors: unknown[] = [];
    const out = bootFeed(
      () => {
        throw new Error("boom");
      },
      { start: () => void starts.push("start") },
      false,
      (e) => void errors.push(e),
    );
    expect(out).toBeNull();
    expect(starts).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("builds the shared feed once, and retries after a failure", () => {
    let builds = 0;
    const get = createLazy(() => {
      builds += 1;
      if (builds === 1) throw new Error("first fails");
      return { id: builds };
    });
    expect(() => get()).toThrow();
    const a = get();
    expect(get()).toBe(a);
    expect(builds).toBe(2);
  });
});

describe("css scoping", () => {
  const dir = __dirname;

  it("settings css has no bare table rules and no overlay table class names", () => {
    const settings = join(dir, "..");
    const files = [
      join(settings, "settings.css"),
      join(settings, "overlays", "overlays.css"),
      join(settings, "overlays", "columns.css"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Element rules would restyle the Fuel overlay's own table in the preview.
      expect(text, file).not.toMatch(/^\s*(table|th|td|tr)\s*[,{:]/m);
      // `.ov-section` and `.ov-row` are the overlay table's (display: contents).
      expect(text, file).not.toMatch(/\.ov-(section|row)\b(?!-)/);
    }
  });

  it("never imports the overlay window stylesheet", () => {
    const sources = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/import\s+["'][^"']*overlay\.css["']/);
    }
  });

  it("scopes every preview rule under pv- and does not touch html, body or :root", () => {
    const css = readFileSync(join(dir, "preview.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/([^{};]+)\{/g)].map((m) => (m[1] ?? "").trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const group of selectors) {
      for (const sel of group.split(",").map((s) => s.trim())) {
        expect(sel, sel).toMatch(/^\.pv-/);
      }
    }
  });
});

describe("preview title bar", () => {
  it("draws the in-flow bar only when showTitleBar is on", () => {
    expect(render("fuel")).not.toContain("pv-titlebar");
    const html = render("fuel", { common: { showTitleBar: true } });
    expect(html).toContain("pv-titlebar");
    expect(html).toContain(`>${mod("fuel").manifest.title}<`);
  });
});
