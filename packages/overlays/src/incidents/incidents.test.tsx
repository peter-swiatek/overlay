import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { IncidentsOverlay } from "./IncidentsOverlay";
import { incidentsManifest } from "./manifest";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(incidentsManifest);
  const settings = applySettingsPatch(incidentsManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <IncidentsOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

function frame(own: number, pen: number | null = 17, dq: number | null = 25): TelemetryFrame {
  return fixtureFrame({
    cars: [{ carIdx: 0 }],
    playerCarIdx: 0,
    session: { incidentLimit: dq, incidentPenaltyLimit: pen, teamRacing: false },
    player: { incidentCount: own },
  });
}

describe("incidents manifest", () => {
  it("is an iRacing-only 120 x 77 panel, off by default, and registered", () => {
    const m = incidentsManifest;
    expect(m.id).toBe("incidents");
    expect(m.sims).toEqual(["iracing"]);
    expect(m.defaultSize).toEqual({ width: 120, height: 77 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(manifestById("incidents")).toBe(m);
    expect(moduleById("incidents")?.Component).toBe(IncidentsOverlay);
  });
});

describe("IncidentsOverlay", () => {
  it("shows a clean race like the design", () => {
    const html = render(frame(0));
    expect(html).toContain(">INCIDENTS<");
    expect(html).toContain("inc-pill--clean");
    expect(html).toContain(">CLEAN<");
    expect(html).toMatch(/inc-num">0<\/span><span class="inc-x">x</);
    expect(html).toContain("17x");
    expect(html).toContain('inc-limit-value--dq">25x');
    expect(html.indexOf('data-segment="pen"')).toBeLessThan(html.indexOf('data-segment="dq"'));
    expect(html).toContain("flex-grow:0.68");
    expect(html).toContain("flex-grow:0.32");
  });

  it.each([
    [2, "caution", "CAUTION"],
    [17, "penalty", "PENALTY"],
    [25, "dq", "DQ"],
  ] as const)("shows %i incidents as %s", (n, status, label) => {
    const html = render(frame(n));
    expect(html).toContain(`inc-pill--${status}`);
    expect(html).toContain(`>${label}<`);
  });

  it("fills the penalty track, then the DQ track", () => {
    const fills = (n: number) =>
      [...render(frame(n)).matchAll(/inc-fill" style="width:([\d.]+)%/g)].map((m) => m[1]);
    expect(fills(0)).toEqual(["0.0", "0.0"]);
    expect(fills(2)).toEqual(["11.8", "0.0"]);
    expect(fills(21)).toEqual(["100.0", "50.0"]);
  });

  it("hides an unknown limit with its bar track, and both when there are none", () => {
    const noPen = render(frame(3, null, 25));
    expect(noPen).not.toContain("Pen:");
    expect(noPen).toContain("DQ:");
    expect(noPen).not.toContain('data-segment="dq"');
    expect(noPen).toContain('data-segment="pen"');
    const none = render(frame(3, null, null));
    expect(none).not.toContain("inc-limits");
    expect(none).not.toContain("inc-bar");
    expect(none).toContain(">CAUTION<");
  });

  it("hides the limits and the bar from the settings", () => {
    const html = render(frame(3), { "show-limits": false, "show-bar": false });
    expect(html).not.toContain("inc-limits");
    expect(html).not.toContain("inc-bar");
    expect(html).toContain("inc-num");
  });

  it("labels the team total in team events", () => {
    const f = frame(3);
    f.state.session.teamRacing = true;
    f.state.player.teamIncidentCount = 11;
    const html = render(f);
    expect(html).toContain(">TEAM INC<");
    expect(html).toContain('inc-num">11<');
  });

  it("renders nothing without data, the sample when editing", () => {
    expect(render(null)).toBe("");
    const html = render(null, {}, { editing: true });
    expect(html).toContain(">CLEAN<");
    expect(html).toContain("25x");
  });
});

describe("Incidents CSS", () => {
  const css = readFileSync(join(__dirname, "incidents.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size and the panel outline", () => {
    expect(rule(".inc")).toContain("font-size: calc(var(--ov-font-size, 14px) * 0.8);");
    expect(rule(".inc::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });

  it("takes its colours only from theme tokens and locked colours", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".inc-pill--clean")).toContain("var(--ov-locked-gain)");
    expect(rule(".inc-pill--caution")).toContain("var(--ov-locked-flag-yellow)");
    expect(rule(".inc-pill--penalty")).toContain("var(--ov-locked-loss)");
    expect(rule(".inc-limit-value--dq")).toContain("var(--ov-locked-loss)");
  });
});
