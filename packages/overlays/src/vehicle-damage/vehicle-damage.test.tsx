import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { vehicleDamageManifest } from "./manifest";
import { damage, damageFrame } from "./testing";
import { VehicleDamageOverlay } from "./VehicleDamageOverlay";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(vehicleDamageManifest);
  const settings = applySettingsPatch(vehicleDamageManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <VehicleDamageOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

/** The class of the element carrying `attr`. */
function classOf(html: string, attr: string): string | undefined {
  const at = html.indexOf(attr);
  const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at));
  return /class="([^"]*)"/.exec(tag)?.[1];
}

function wheelClass(html: string, wheel: string): string | undefined {
  const group = html.slice(html.indexOf(`data-wheel="${wheel}"`));
  return /<rect class="([^"]*)"/.exec(group)?.[1];
}

describe("vehicle damage manifest", () => {
  it("is an LMU-only 220 x 260 panel, off by default, and registered", () => {
    const m = vehicleDamageManifest;
    expect(m.id).toBe("vehicle-damage");
    expect(m.sims).toEqual(["lmu"]);
    expect(m.defaultSize).toEqual({ width: 220, height: 260 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(defaultInstanceSettings(m).options).toMatchObject({
      "hide-clean": false,
      "show-details": true,
    });
    expect(manifestById("vehicle-damage")).toBe(m);
    expect(moduleById("vehicle-damage")?.Component).toBe(VehicleDamageOverlay);
  });
});

describe("VehicleDamageOverlay", () => {
  it("shows a clean car in green with NO DAMAGE", () => {
    const html = render(damageFrame(damage()));
    expect(html).toContain(">DAMAGE STATUS<");
    expect(html).toContain('vd-pill vd-pill--ok">NO DAMAGE<');
    expect(classOf(html, 'data-part="front-wing"')).toBe("vd-shape vd-shape--ok");
    expect(classOf(html, 'data-part="rear-wing"')).toBe("vd-shape vd-shape--ok");
    expect(html).toContain("vd-body vd-body--ok");
    for (const w of ["fl", "fr", "rl", "rr"]) expect(wheelClass(html, w)).toBe("vd-wheel");
  });

  it("colours each part by its zone: the recorded crash", () => {
    const html = render(damageFrame(damage([2, 0, 0, 2, 2], { rl: true }, 349.72), 351.4));
    expect(html).toContain('vd-pill--heavy">HEAVY DAMAGE<');
    expect(classOf(html, 'data-part="front-wing"')).toBe("vd-shape vd-shape--heavy");
    expect(classOf(html, 'data-part="rear-wing"')).toBe("vd-shape vd-shape--heavy");
    expect(classOf(html, 'data-zone="rearLeft"')).toBe("vd-edge vd-edge--heavy");
    expect(classOf(html, 'data-zone="rearRight"')).toBe("vd-edge vd-edge--ok");
    expect(classOf(html, 'data-zone="left"')).toBe("vd-edge vd-edge--ok");
    expect(html).toContain("vd-body vd-body--heavy");
    expect(wheelClass(html, "rl")).toBe("vd-wheel vd-wheel--flat");
    expect(wheelClass(html, "rr")).toBe("vd-wheel");
    expect(html).toContain('<span>Front</span><b class="vd-val vd-val--heavy">Heavy</b>');
    expect(html).toContain('<span>Rear</span><b class="vd-val vd-val--heavy">Heavy</b>');
    expect(html).toContain('<span>Tyres</span><b class="vd-val vd-val--heavy">RL flat</b>');
    expect(html).toContain('<span>Last hit</span><b class="vd-val vd-val--plain">1 s ago</b>');
  });

  it("shows a minor knock to the nose in yellow", () => {
    const html = render(damageFrame(damage([1], {}, 358), 400));
    expect(html).toContain('vd-pill--minor">MINOR FRONT<');
    expect(classOf(html, 'data-part="front-wing"')).toBe("vd-shape vd-shape--minor");
    expect(classOf(html, 'data-zone="front"')).toBe("vd-edge vd-edge--minor");
    expect(html).toContain("vd-body vd-body--ok");
    expect(html).toContain('<span>Front</span><b class="vd-val vd-val--minor">Minor</b>');
    expect(html).toContain('<span>Rear</span><b class="vd-val vd-val--ok">OK</b>');
    expect(html).toContain(">42 s ago<");
  });

  it("leaves out what the sim does not give: aero %, suspension, repair time", () => {
    const html = render(damageFrame(damage([1])));
    for (const text of ["Aero", "Susp", "Toe", "Repair", "km/h", "%"]) {
      expect(html).not.toContain(text);
    }
    // The suspension arms are drawn, but in a neutral colour.
    expect(html.match(/class="vd-arm"/g)).toHaveLength(4);
  });

  it("drops the details when switched off", () => {
    const html = render(damageFrame(damage([1])), { "show-details": false });
    expect(html).not.toContain("vd-details");
    expect(html).toContain("vd-car");
  });

  it("hides on a clean car only when asked, and never in edit mode", () => {
    expect(render(damageFrame(damage()), { "hide-clean": true })).toBe("");
    expect(render(damageFrame(damage([1])), { "hide-clean": true })).toContain("MINOR FRONT");
    expect(render(damageFrame(damage()), { "hide-clean": true }, { editing: true })).toContain(
      "NO DAMAGE",
    );
  });

  it("renders nothing without data, and the design's sample in edit mode", () => {
    expect(render(null)).toBe("");
    expect(render(damageFrame(null))).toBe("");
    const sample = render(null, {}, { editing: true });
    expect(sample).toContain('vd-pill--minor">MINOR FRONT<');
    expect(classOf(sample, 'data-part="front-wing"')).toBe("vd-shape vd-shape--minor");
  });
});

describe("vehicle damage CSS", () => {
  const css = readFileSync(join(__dirname, "vehicle-damage.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size and the panel outline", () => {
    expect(rule(".vd")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".vd::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });

  it("takes its colours only from theme tokens and locked colours", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".vd-edge--ok")).toContain("var(--ov-locked-gain)");
    expect(rule(".vd-edge--minor")).toContain("var(--ov-locked-rejoin-yellow)");
    expect(rule(".vd-edge--heavy")).toContain("var(--ov-locked-loss)");
  });

  it("sizes text in em only", () => {
    expect(css).not.toMatch(/font-size:\s*[\d.]+px/);
  });
});
