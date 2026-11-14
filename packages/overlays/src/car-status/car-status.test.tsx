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
import { tyresManifest } from "../tyres/manifest";
import { damage } from "../vehicle-damage/testing";
import { CarStatusOverlay, tempText } from "./CarStatusOverlay";
import { carStatusManifest } from "./manifest";
import { carFrame, restDamage } from "./testing";

const imperial = { ...DEFAULT_DISPLAY_PREFS, units: "imperial" as const };

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(carStatusManifest);
  const settings = applySettingsPatch(carStatusManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <CarStatusOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

/** The class of the first element carrying `attr`. */
function classOf(html: string, attr: string): string | undefined {
  const at = html.indexOf(attr);
  const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at));
  return /class="([^"]*)"/.exec(tag)?.[1];
}

/** One wheel's group, from its opening tag to its closing one. */
function wheelGroup(html: string, id: string): string {
  const start = html.indexOf(`data-wheel="${id}"`);
  return html.slice(start, html.indexOf("</g>", start));
}

/** The classes of one wheel's parts: tyre block, brake strip and suspension chevron. */
function wheel(html: string, id: string): { tyre?: string; brake?: string; chevron?: string } {
  const group = wheelGroup(html, id);
  const part = (name: string) =>
    /class="([^"]*)"/.exec(
      group.slice(group.lastIndexOf("<", group.indexOf(`data-part="${name}"`))),
    )?.[1];
  return { tyre: part("tyre"), brake: part("brake"), chevron: part("suspension") };
}

/** The values of one corner's column, top to bottom. */
function cornerValues(html: string, id: string): string[] {
  const start = html.indexOf(`data-corner="${id}"`);
  const end = html.indexOf("data-corner=", start + 1);
  const block = html.slice(start, end === -1 ? undefined : end);
  return [...block.matchAll(/<b class="cs-val[^"]*">([^<]*)<\/b>/g)].map((m) => m[1] ?? "");
}

describe("car status manifest", () => {
  it("is an LMU-only 440 x 300 panel, off by default, and registered", () => {
    const m = carStatusManifest;
    expect(m.id).toBe("car-status");
    expect(m.title).toBe("Car Status");
    expect(m.sims).toEqual(["lmu"]);
    expect(m.defaultSize).toEqual({ width: 440, height: 300 });
    expect(m.minSize).toEqual({ width: 340, height: 240 });
    // On a 1920 x 1080 screen.
    expect(m.defaultPosition.x + m.defaultSize.width).toBeLessThanOrEqual(1920);
    expect(m.defaultPosition.y + m.defaultSize.height).toBeLessThanOrEqual(1080);
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(defaultInstanceSettings(m).options).toMatchObject({
      "show-temp": true,
      "show-pressure": true,
      "show-tread": true,
      "show-suspension": true,
      "show-brake": true,
      "show-engine": true,
      "show-aero": true,
    });
    expect(manifestById("car-status")).toBe(m);
    expect(moduleById("car-status")?.Component).toBe(CarStatusOverlay);
  });

  it("takes the Tyres overlay's temperature window and defaults", () => {
    const pick = (keys: string[], o: Record<string, unknown>) =>
      Object.fromEntries(keys.map((k) => [k, o[k]]));
    const keys = ["temp-cold", "temp-hot", "temp-overheat", "temp-source", "pressure-unit"];
    expect(pick(keys, defaultInstanceSettings(carStatusManifest).options)).toEqual(
      pick(keys, defaultInstanceSettings(tyresManifest).options),
    );
  });
});

describe("CarStatusOverlay", () => {
  it("lists each corner's values, front corners above rear ones", () => {
    const html = render(carFrame({ damage: restDamage([], 0, { fl: 0, fr: 0.03, rl: 0, rr: 0 }) }));
    // The design set's FL: 97/94/90 surface, 3 C cooler under the tread.
    expect(cornerValues(html, "fl")).toEqual(["91°C", "172 kPa", "93%", "0.0%", "490°C"]);
    expect(cornerValues(html, "fr")).toEqual(["93°C", "174 kPa", "91%", "3.0%", "510°C"]);
    expect(html.indexOf('data-corner="fl"')).toBeLessThan(html.indexOf('data-corner="rl"'));
    expect(html.indexOf('data-corner="rl"')).toBeLessThan(html.indexOf('data-corner="fr"'));
    expect(html).toContain('<b class="cs-val cs-val--minor">3.0%</b>');
  });

  it("follows the unit preferences and the pressure option", () => {
    const html = render(carFrame(), {}, { prefs: imperial });
    expect(cornerValues(html, "fl")).toEqual(["195°F", "24.9 psi", "93%", "914°F"]);
    expect(html).toContain("187°F"); // water
    expect(cornerValues(render(carFrame(), { "pressure-unit": "bar" }), "fl")[1]).toBe("1.72 bar");
    expect(tempText(null, imperial)).toBe("--");
  });

  it("colours the outline by dent zone and the tyres by temperature", () => {
    const html = render(carFrame({ damage: damage([1, 0, 0, 2]) }));
    expect(classOf(html, 'data-zone="front"')).toBe("cs-seg cs-seg--minor");
    expect(classOf(html, 'data-zone="rearLeft"')).toBe("cs-seg cs-seg--heavy");
    expect(classOf(html, 'data-zone="right"')).toBe("cs-seg cs-seg--ok");
    expect(html.match(/data-zone="rear"/g)).toHaveLength(2);
    // Design set: FL's hottest point is 97 C at the surface, 94 C under the tread.
    expect(wheel(html, "fl").tyre).toBe("cs-tyre cs-tyre--ok");
    const surface = render(carFrame(), { "temp-source": "surface" });
    expect(wheel(surface, "fl").tyre).toBe("cs-tyre cs-tyre--hot");
    expect(wheel(render(carFrame(), { "temp-cold": 100 }), "rl").tyre).toBe(
      "cs-tyre cs-tyre--cold",
    );
    const flat = render(carFrame({ damage: damage([], { rl: true }) }));
    expect(wheel(flat, "rl").tyre).toBe("cs-tyre cs-tyre--flat");
  });

  it("draws each wheel from the body outward: suspension chevron, brake strip, tyre", () => {
    const html = render(carFrame());
    for (const id of ["fl", "fr", "rl", "rr"]) {
      const parts = [...wheelGroup(html, id).matchAll(/data-part="([^"]*)"/g)].map((m) => m[1]);
      expect(parts).toEqual(["suspension", "brake", "tyre"]);
    }
    // The brake strip belongs to the wheel, not to the body outline.
    expect(html.match(/data-part="brake"/g)).toHaveLength(4);
    expect(html.match(/data-zone=/g)).toHaveLength(9);
  });

  it("colours each brake strip by its disc temperature", () => {
    // Design set: 490 / 510 C at the front.
    expect(wheel(render(carFrame()), "fl").brake).toBe("cs-brake cs-brake--ok");
    const sample = render(null, {}, { editing: true });
    expect(wheel(sample, "fr").brake).toBe("cs-brake cs-brake--ok");
    const none = render(carFrame({ tyres: false }));
    expect(wheel(none, "rr").brake).toBe("cs-brake cs-brake--unknown");
  });

  it("shows suspension and aero damage only while the game's repair screen answers", () => {
    const withRest = render(
      carFrame({ damage: restDamage([1], 0.0533, { fl: 0.057, fr: 0, rl: 0.138, rr: 0 }) }),
    );
    expect(wheel(withRest, "fl").chevron).toBe("cs-chev cs-chev--minor");
    expect(wheel(withRest, "rl").chevron).toBe("cs-chev cs-chev--heavy");
    expect(wheel(withRest, "fr").chevron).toBe("cs-chev cs-chev--ok");
    expect(withRest).toMatch(/class="cs-aero cs-aero--minor"><small>AERO<\/small>5(<!-- -->)?%/);
    expect(withRest).toContain(">SUSP<");

    const shmOnly = render(carFrame({ damage: damage([1]) }));
    expect(shmOnly).not.toContain("SUSP");
    expect(shmOnly).not.toContain("AERO");
    expect(wheel(shmOnly, "fl").chevron).toBe("cs-chev cs-chev--unknown");
    expect(cornerValues(shmOnly, "fl")).toHaveLength(4);
  });

  it("shows oil above the engine and water below it, and drops what is unknown", () => {
    const html = render(carFrame());
    const oil = html.indexOf('data-value="oil"');
    const engine = html.indexOf("cs-icon--engine");
    const water = html.indexOf('data-value="water"');
    expect(oil).toBeGreaterThan(-1);
    expect(oil).toBeLessThan(engine);
    expect(engine).toBeLessThan(water);
    expect(html).toContain("101°C");
    expect(html).toContain("86°C");
    const none = render(carFrame({ waterTempC: null, oilTempC: null }));
    expect(none).not.toContain("cs-icon--engine");
    expect(render(carFrame({ oilTempC: null }))).toMatch(/data-value="oil">.*?--<\/span>/);
  });

  it("drops rows and the centre when switched off", () => {
    const html = render(
      carFrame({ damage: restDamage([], 0.06, { fl: 0, fr: 0, rl: 0, rr: 0 }) }),
      { "show-pressure": false, "show-brake": false, "show-engine": false, "show-aero": false },
    );
    expect(cornerValues(html, "fl")).toEqual(["91°C", "93%", "0.0%"]);
    expect(html).not.toContain("cs-centre");
    expect(html).toContain("cs-car");
  });

  it("renders nothing without data, and a sample in edit mode", () => {
    expect(render(null)).toBe("");
    expect(render(carFrame({ tyres: false, damage: null, waterTempC: null, oilTempC: null }))).toBe(
      "",
    );
    const sample = render(null, {}, { editing: true });
    expect(cornerValues(sample, "fl")).toEqual(["86°C", "172 kPa", "74%", "0.0%", "412°C"]);
    expect(cornerValues(sample, "rr")).toEqual(["88°C", "169 kPa", "72%", "0.0%", "371°C"]);
    expect(sample).toContain("104°C");
    expect(sample).toContain("88°C");
    expect(classOf(sample, 'data-zone="frontLeft"')).toBe("cs-seg cs-seg--minor");
    expect(classOf(sample, 'data-zone="right"')).toBe("cs-seg cs-seg--minor");
  });
});

describe("car status CSS", () => {
  const css = readFileSync(join(__dirname, "car-status.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size, the panel outline and the accent bar", () => {
    expect(rule(".cs")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".cs::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
    expect(rule(".cs::before")).toContain("background: var(--ov-accent);");
  });

  it("takes its colours only from theme tokens and locked colours", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".cs-tyre--ok")).toContain("var(--ov-locked-gain)");
    expect(rule(".cs-tyre--cold")).toContain("var(--ov-locked-tyre-cold)");
    expect(rule(".cs-tyre--hot")).toContain("var(--ov-locked-flag-yellow)");
    expect(rule(".cs-tyre--overheat")).toContain("var(--ov-locked-loss)");
    expect(rule(".cs-seg--minor")).toContain("var(--ov-locked-rejoin-yellow)");
    expect(rule(".cs-seg--heavy")).toContain("var(--ov-locked-loss)");
    expect(rule(".cs-brake--cold")).toContain("var(--ov-locked-tyre-cold)");
    expect(rule(".cs-brake--ok")).toContain("var(--ov-locked-gain)");
    expect(rule(".cs-brake--hot")).toContain("var(--ov-locked-flag-yellow)");
    expect(rule(".cs-brake--veryHot")).toContain("var(--ov-locked-loss)");
  });

  it("sizes text in em only", () => {
    expect(css).not.toMatch(/font-size:\s*[\d.]+px/);
  });
});
