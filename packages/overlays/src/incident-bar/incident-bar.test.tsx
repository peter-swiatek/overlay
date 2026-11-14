import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncidentAhead, TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { IncidentBarOverlay } from "./IncidentBarOverlay";
import { incidentBarManifest } from "./manifest";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(incidentBarManifest);
  const settings = applySettingsPatch(incidentBarManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <IncidentBarOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

function frame(patch: Partial<IncidentAhead> | null): TelemetryFrame {
  const f = fixtureFrame({ cars: [{ carIdx: 0 }, { carIdx: 2 }], playerCarIdx: 0 });
  f.derived.incidentAhead =
    patch === null
      ? null
      : {
          carIdx: 2,
          carNumber: "3",
          distanceM: 180,
          kind: "off",
          stopped: false,
          corner: 7,
          ...patch,
        };
  return f;
}

describe("incident bar manifest", () => {
  it("is a 360 x 24 bar for both sims, off by default, and registered", () => {
    const m = incidentBarManifest;
    expect(m.id).toBe("incident-bar");
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.defaultSize).toEqual({ width: 360, height: 24 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(defaultInstanceSettings(m).options).toMatchObject({
      range: 300,
      "red-distance": 100,
      "corner-labels": true,
    });
    expect(manifestById("incident-bar")).toBe(m);
    expect(moduleById("incident-bar")?.Component).toBe(IncidentBarOverlay);
  });
});

describe("IncidentBarOverlay", () => {
  it("shows the label between two yellow fills like the design", () => {
    const html = render(frame({}));
    expect(html).toContain('class="ib ib--yellow"');
    expect(html).toContain("--ib-fill:36%");
    expect(html).toContain('class="ib-fill ib-fill--left"');
    expect(html).toContain('class="ib-fill ib-fill--right"');
    expect(html).toContain(">▲ INCIDENT AHEAD · 180 m (3 OFF T7) ▲<");
    expect(html).not.toContain("#3");
  });

  it("turns red for a stopped car close ahead", () => {
    const html = render(frame({ kind: "stopped", stopped: true, distanceM: 60, corner: null }));
    expect(html).toContain('class="ib ib--red"');
    expect(html).toContain(">▲ INCIDENT AHEAD · 60 m (3 STOPPED) ▲<");
  });

  it("follows the settings", () => {
    const off = render(frame({}), { "corner-labels": false });
    expect(off).toContain("(3 OFF)");
    expect(render(frame({}), { range: 150 })).toBe("");
    const stopped = { kind: "stopped" as const, stopped: true, distanceM: 60 };
    expect(render(frame(stopped), { "red-distance": 50 })).toContain("ib--yellow");
  });

  it("is empty with nothing ahead, and shows a sample when editing", () => {
    expect(render(frame(null))).toBe("");
    expect(render(null)).toBe("");
    const html = render(null, {}, { editing: true });
    expect(html).toContain(">▲ INCIDENT AHEAD · 180 m (3 OFF T7) ▲<");
    expect(render(frame({ kind: "slow", distanceM: 120 }), {}, { editing: true })).toContain(
      "120 m (3 SLOW T7)",
    );
  });
});

describe("Incident Bar CSS", () => {
  const css = readFileSync(join(__dirname, "incident-bar.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size and the panel outline", () => {
    expect(rule(".ib")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".ib::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });

  it("takes its colours only from theme tokens and locked colours", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".ib--yellow")).toContain("var(--ov-locked-flag-yellow)");
    expect(rule(".ib--red")).toContain("var(--ov-locked-loss)");
  });
});
