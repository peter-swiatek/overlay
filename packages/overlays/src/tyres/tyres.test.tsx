import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { DEFAULT_DISPLAY_PREFS } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { designTyres, fitSet, tyreCorner, tyresFrame } from "./testing";
import { tyresManifest } from "./manifest";
import { degreesText, pressureText, pressureUnit, TyresOverlay } from "./TyresOverlay";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(tyresManifest);
  const settings = applySettingsPatch(tyresManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <TyresOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

/** The three temperatures of one card, left to right. */
function temps(html: string, corner: string): string[] {
  const card = html.slice(html.indexOf(`data-corner="${corner}"`));
  const strip = card.slice(card.indexOf("ty-temps"), card.indexOf("ty-card-foot"));
  return [...strip.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1] ?? "");
}

function cardClass(html: string, corner: string, prefix: string): string | undefined {
  const card = html.slice(html.indexOf(`data-corner="${corner}"`));
  return card.match(new RegExp(`${prefix}--([a-z]+)`))?.[1];
}

const imperial = { ...DEFAULT_DISPLAY_PREFS, units: "imperial" as const };

describe("tyres manifest", () => {
  it("is an LMU-only 260 x 220 panel, off by default, and registered", () => {
    const m = tyresManifest;
    expect(m.id).toBe("tyres");
    expect(m.sims).toEqual(["lmu"]);
    expect(m.defaultSize).toEqual({ width: 260, height: 220 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(manifestById("tyres")).toBe(m);
    expect(moduleById("tyres")?.Component).toBe(TyresOverlay);
  });
});

describe("TyresOverlay", () => {
  it("shows the design: compound pill, tread, the layer under the tread, kPa and brakes", () => {
    const html = render(tyresFrame());
    expect(html).toContain(">4-CORNER TYRES<");
    expect(html).toContain('ty-pill--medium">MEDIUM · L15<');
    expect(temps(html, "fl")).toEqual(["87°", "91°", "94°"]);
    expect(temps(html, "fr")).toEqual(["96°", "93°", "89°"]);
    expect(temps(html, "rl")).toEqual(["85°", "88°", "90°"]);
    expect(temps(html, "rr")).toEqual(["91°", "89°", "86°"]);
    expect(html).toContain('ty-tread--ok">93%<');
    expect(html).toContain('ty-tread--ok">91%<');
    expect(cardClass(html, "fl", "ty-temps")).toBe("ok");
    expect(cardClass(html, "fr", "ty-temps")).toBe("hot");
    expect(html).toContain("<span>172 kPa</span><span>Brk 490°</span>");
    expect(html.indexOf('data-corner="fl"')).toBeLessThan(html.indexOf('data-corner="fr"'));
    expect(html.indexOf('data-corner="fr"')).toBeLessThan(html.indexOf('data-corner="rl"'));
    expect(html.indexOf('data-corner="rl"')).toBeLessThan(html.indexOf('data-corner="rr"'));
  });

  it("shows the surface temperatures when chosen, and falls back to them without the layer", () => {
    expect(temps(render(tyresFrame(), { "temp-source": "surface" }), "fl")).toEqual([
      "90°",
      "94°",
      "97°",
    ]);
    const t = designTyres();
    t.fl.innerLayerTemps = null;
    expect(temps(render(tyresFrame(t)), "fl")).toEqual(["90°", "94°", "97°"]);
  });

  it("colours tread and temperature bands from the settings", () => {
    const t = designTyres();
    t.fl = tyreCorner(0.5, [80, 75, 72]);
    t.fr = tyreCorner(0.7, [115, 100, 95]);
    t.rl = tyreCorner(null, [60, 58, 55]);
    const html = render(tyresFrame(t));
    expect(cardClass(html, "fl", "ty-tread")).toBe("warn");
    expect(cardClass(html, "fr", "ty-tread")).toBe("critical");
    expect(cardClass(html, "rl", "ty-tread")).toBe("unknown");
    expect(html).toContain('ty-tread--unknown">--<');
    expect(cardClass(html, "fl", "ty-temps")).toBe("ok");
    expect(cardClass(html, "fr", "ty-temps")).toBe("overheat");
    expect(cardClass(html, "rl", "ty-temps")).toBe("cold");
    const custom = render(tyresFrame(t), {
      "temp-cold": 75,
      "tread-warn": 40,
      "temp-overheat": 120,
    });
    expect(cardClass(custom, "fl", "ty-temps")).toBe("cold");
    expect(cardClass(custom, "fl", "ty-tread")).toBe("ok");
    expect(cardClass(custom, "fr", "ty-temps")).toBe("hot");
  });

  it("follows the unit preference and the pressure unit setting", () => {
    const html = render(tyresFrame(), {}, { prefs: imperial });
    expect(temps(html, "fl")).toEqual(["189°", "196°", "201°"]);
    expect(html).toContain("<span>24.9 psi</span><span>Brk 914°</span>");
    expect(render(tyresFrame(), { "pressure-unit": "bar" })).toContain("1.72 bar");
    expect(render(tyresFrame(), { "pressure-unit": "kpa" }, { prefs: imperial })).toContain(
      "172 kPa",
    );
  });

  it("hides the pill and the brakes from the settings", () => {
    const html = render(tyresFrame(), { "show-compound": false, "show-brakes": false });
    expect(html).not.toContain("ty-pill");
    expect(html).not.toContain("Brk");
    expect(html).toContain("172 kPa");
  });

  it("shows the compound alone when the laps on the set are unknown, in its family colour", () => {
    const t = fitSet(designTyres(), "Soft");
    expect(render(tyresFrame(t, null))).toContain('ty-pill--soft">SOFT<');
    fitSet(t, "Wet");
    expect(render(tyresFrame(t, 2))).toContain('ty-pill--wet">WET · L2<');
  });

  it("puts each tyre's compound next to its name, and MIXED on the pill when they differ", () => {
    const same = render(tyresFrame());
    for (const corner of ["fl", "fr", "rl", "rr"]) {
      expect(cardClass(same, corner, "ty-cmp")).toBe("medium");
    }
    expect(same).toContain(
      '<span class="ty-corner">FL<span class="ty-cmp ty-cmp--medium" title="Medium">M</span></span>',
    );
    const t = designTyres();
    t.fl.compound = "Soft";
    t.fr.compound = "Hard";
    t.rl.compound = "Wet";
    t.rr.compound = "Bias-ply";
    const mixed = render(tyresFrame(t));
    expect(mixed).toContain('ty-pill--other">MIXED · L15<');
    expect(cardClass(mixed, "fl", "ty-cmp")).toBe("soft");
    expect(cardClass(mixed, "fr", "ty-cmp")).toBe("hard");
    expect(cardClass(mixed, "rl", "ty-cmp")).toBe("wet");
    expect(cardClass(mixed, "rr", "ty-cmp")).toBe("other");
    expect(mixed).toContain('title="Soft">S<');
    expect(mixed).toContain('title="Hard">H<');
    expect(mixed).toContain('title="Wet">W<');
    expect(mixed).toContain('title="Bias-ply">?<');
  });

  it("follows the axle compounds of a state without one per tyre, and hides unknown ones", () => {
    const t = designTyres();
    for (const c of [t.fl, t.fr, t.rl, t.rr]) delete c.compound;
    t.frontCompound = "Soft";
    t.rearCompound = null;
    const html = render(tyresFrame(t));
    expect(cardClass(html, "fr", "ty-cmp")).toBe("soft");
    expect(html).toContain('<span class="ty-corner">RL</span>');
    expect(html).toContain('ty-pill--soft">SOFT · L15<');
  });

  it("hides the badges from the settings, and then spells out a front/rear split", () => {
    const t = designTyres();
    t.rl.compound = "Hard";
    t.rr.compound = "Hard";
    const html = render(tyresFrame(t), { "show-tyre-compound": false });
    expect(html).not.toContain("ty-cmp");
    expect(html).toContain('ty-pill--medium">MEDIUM / HARD · L15<');
    expect(render(tyresFrame(t))).toContain('ty-pill--other">MIXED · L15<');
  });

  it("renders nothing without data, the design sample when editing", () => {
    expect(render(null)).toBe("");
    expect(render(tyresFrame(null))).toBe("");
    const html = render(null, {}, { editing: true });
    expect(html).toContain("MEDIUM · L15");
    expect(cardClass(html, "rr", "ty-cmp")).toBe("medium");
    expect(temps(html, "fr")).toEqual(["96°", "93°", "89°"]);
    expect(html).toContain("<span>174 kPa</span><span>Brk 510°</span>");
  });
});

describe("unit helpers", () => {
  it("formats pressure and degrees", () => {
    expect(pressureUnit("auto", DEFAULT_DISPLAY_PREFS)).toBe("kpa");
    expect(pressureUnit("auto", imperial)).toBe("psi");
    expect(pressureUnit("bar", imperial)).toBe("bar");
    expect(pressureText(171.6, "kpa")).toBe("172 kPa");
    expect(pressureText(null, "kpa")).toBe("-- kPa");
    expect(pressureText(null, "psi")).toBe("-- psi");
    expect(degreesText(null, DEFAULT_DISPLAY_PREFS)).toBe("--");
    expect(degreesText(100, imperial)).toBe("212°");
  });
});

describe("Tyres CSS", () => {
  const css = readFileSync(join(__dirname, "tyres.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size and the panel outline", () => {
    expect(rule(".ty")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".ty::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });

  it("takes its colours only from theme tokens and locked colours", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".ty-tread--ok")).toContain("var(--ov-locked-gain)");
    expect(rule(".ty-tread--warn")).toContain("var(--ov-locked-flag-yellow)");
    expect(rule(".ty-tread--critical")).toContain("var(--ov-locked-loss)");
    expect(rule(".ty-temps--cold")).toContain("var(--ov-locked-tyre-cold)");
    expect(rule(".ty-pill--medium")).toContain("background: var(--ov-locked-flag-yellow)");
  });

  it("colours the tyre badges like the pill", () => {
    for (const family of ["soft", "medium", "hard", "inter", "wet", "other"]) {
      expect(css).toContain(`.ty-cmp--${family},\n.ty-pill--${family} {`);
    }
  });

  it("draws a faint divider between the three temperatures", () => {
    expect(rule(".ty-temps > span + span")).toContain("border-left: 1px solid");
  });

  it("sizes type in em", () => {
    expect(css.match(/font-size: [\d.]+px/g)).toBeNull();
  });
});
