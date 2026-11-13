import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Flags, TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { DigiFlagOverlay } from "./DigiFlagOverlay";
import { digiFlagManifest } from "./manifest";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(digiFlagManifest);
  const settings = applySettingsPatch(digiFlagManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <DigiFlagOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

function frame(flags: Partial<Flags> | null): TelemetryFrame {
  return fixtureFrame({ cars: [{ carIdx: 0 }], playerCarIdx: 0, flags });
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe("digi flag manifest", () => {
  it("is a 120 x 120 panel for both sims, off by default, and registered", () => {
    const m = digiFlagManifest;
    expect(m.id).toBe("digi-flag");
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.defaultSize).toEqual({ width: 120, height: 120 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(defaultInstanceSettings(m).options).toMatchObject({
      "hide-idle": false,
      blink: false,
      "green-seconds": 5,
    });
    expect(manifestById("digi-flag")).toBe(m);
    expect(moduleById("digi-flag")?.Component).toBe(DigiFlagOverlay);
  });
});

describe("DigiFlagOverlay", () => {
  it("shows a header, a 6 x 4 LED grid and a caption like the design", () => {
    const html = render(frame({ yellow: true }));
    expect(html).toContain('class="df df--yellow"');
    expect(html).toContain('<span class="df-title">FLAG</span><span class="df-code">YLW</span>');
    expect(count(html, 'class="df-led df-led--on"')).toBe(24);
    expect(html).toContain('<div class="df-caption">CAUTION</div>');
  });

  it("draws checkered as a two-tone pattern", () => {
    const html = render(frame({ checkered: true, white: true }));
    expect(html).toContain('class="df df--white"');
    expect(count(html, 'class="df-led df-led--on"')).toBe(12);
    expect(count(html, 'class="df-led"')).toBe(12);
    expect(html).toContain(">FINISH<");
  });

  it("shows a dim panel when no flag is out, or nothing with hide when no flag", () => {
    const html = render(frame({}));
    expect(html).toContain('class="df df--idle"');
    expect(count(html, 'class="df-led"')).toBe(24);
    expect(html).not.toContain("df-led--on");
    expect(html).toContain('<span class="df-code"></span>');
    expect(render(frame({}), { "hide-idle": true })).toBe("");
    expect(render(frame({ blue: true }), { "hide-idle": true })).toContain("df--blue");
  });

  it("blinks only with the blink setting", () => {
    expect(render(frame({ blue: true }))).not.toContain("df--blink");
    expect(render(frame({ blue: true }), { blink: true })).toContain(
      'class="df df--blue df--blink"',
    );
  });

  it("is empty without a frame, and shows the yellow S2 sample when editing", () => {
    expect(render(null)).toBe("");
    for (const f of [null, frame({})]) {
      const html = render(f, { "hide-idle": true }, { editing: true });
      expect(html).toContain('<span class="df-code">YLW S2</span>');
      expect(html).toContain(">CAUTION<");
    }
    const red = render(frame({ red: true }), {}, { editing: true });
    expect(red).toContain('class="df df--red"');
  });
});

describe("Digi Flag CSS", () => {
  const css = readFileSync(join(__dirname, "digi-flag.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size and the panel outline", () => {
    expect(rule(".df")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".df")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });

  it("takes its colours only from theme tokens and locked colours", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".df--red")).toContain("var(--ov-locked-flag-red)");
    expect(rule(".df--yellow")).toContain("var(--ov-locked-flag-yellow)");
    expect(rule(".df--blue")).toContain("var(--ov-locked-flag-blue)");
    expect(rule(".df--green")).toContain("var(--ov-locked-flag-green)");
    expect(rule(".df--white")).toContain("var(--ov-locked-flag-white)");
    expect(rule(".df--meatball")).toContain("var(--ov-locked-flag-meatball)");
  });

  it("sizes in em and blinks only with effects on", () => {
    expect(css.replace(/1px var\(--ov-border\)|6px;|14px\)/g, "")).not.toMatch(/\d+px/);
    expect(css).toContain(':root:not([data-reduced-effects="true"]) .df--blink .df-led--on {');
  });
});
