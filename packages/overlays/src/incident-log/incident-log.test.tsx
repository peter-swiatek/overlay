import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncidentLogEvent, TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { FIXTURE_NAMES, fixtureFrame } from "../shared/fixtures";
import { IncidentLogOverlay } from "./IncidentLogOverlay";
import { incidentLogManifest } from "./manifest";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(incidentLogManifest);
  const settings = applySettingsPatch(incidentLogManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <IncidentLogOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

let nextId = 1;
function event(patch: Partial<IncidentLogEvent>): IncidentLogEvent {
  return {
    id: nextId++,
    carIdx: 1,
    carNumber: "12",
    driverName: FIXTURE_NAMES[1]!,
    timeS: 50,
    lap: 3,
    sector: 2,
    corner: null,
    kind: "off-track",
    points: null,
    own: false,
    ...patch,
  };
}

function frame(
  events: IncidentLogEvent[],
  opts: { own?: number | null; pen?: number | null; dq?: number | null; tick?: number } = {},
): TelemetryFrame {
  const f = fixtureFrame({
    cars: [
      { carIdx: 0, driverName: FIXTURE_NAMES[0]!, carNumber: "1" },
      { carIdx: 1, driverName: FIXTURE_NAMES[1]!, carNumber: "12" },
    ],
    playerCarIdx: 0,
    session: {
      incidentPenaltyLimit: opts.pen === undefined ? 17 : opts.pen,
      incidentLimit: opts.dq === undefined ? 25 : opts.dq,
    },
    player: { incidentCount: opts.own === undefined ? 2 : opts.own },
  });
  f.state.tickTimeS = opts.tick ?? 1000;
  f.derived.incidentLog = { events };
  return f;
}

const rows = (html: string) =>
  [...html.matchAll(/class="(il-row[^"]*)" data-event/g)].map((m) => m[1]);

describe("incident log manifest", () => {
  it("is a 380 x 230 iRacing-only panel, off by default, and registered", () => {
    const m = incidentLogManifest;
    expect(m.id).toBe("incident-log");
    expect(m.sims).toEqual(["iracing"]);
    expect(m.defaultSize).toEqual({ width: 380, height: 230 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(manifestById("incident-log")).toBe(m);
    expect(moduleById("incident-log")?.Component).toBe(IncidentLogOverlay);
  });
});

describe("IncidentLogOverlay", () => {
  it("shows the header, the table and the footer like the design", () => {
    const html = render(
      frame([
        event({ timeS: 1491, lap: 15, sector: 2, corner: 7 }),
        event({
          carIdx: 0,
          carNumber: "1",
          driverName: FIXTURE_NAMES[0]!,
          timeS: 845,
          lap: 9,
          sector: 3,
          kind: "loss-of-control",
          points: 2,
          own: true,
        }),
      ]),
    );
    expect(html).toContain(">Session Log<");
    expect(html).toContain(">2x (M. Example) · Field Events<");
    expect(html).toContain(">Limit<");
    expect(html).toContain(">17x / 25x<");
    for (const h of ["Time", "Lap", "Sec", "Incident Type", "Pts"])
      expect(html).toContain(`>${h}<`);
    expect(html).toContain(">24:51<");
    expect(html).toContain(">S2<");
    expect(html).toContain(">12 J. Pérez · Off track (T7)<");
    expect(html).toContain('il-pts--none">--<');
    expect(html).toContain(">1 M. Example · Loss of control<");
    expect(html).toContain('il-pts--loss">2x<');
    expect(html).toContain("Newest on top · Showing 2 records");
    expect(html).not.toContain("ov-row--own");
    expect(html.indexOf(">24:51<")).toBeLessThan(html.indexOf(">14:05<"));
  });

  it("colours points: 0x plain, 1x flag yellow, 2x and more loss red", () => {
    const html = render(
      frame([
        event({ points: 0, kind: "incident" }),
        event({ points: 1 }),
        event({ points: 4, kind: "contact" }),
      ]),
    );
    expect(html).toContain('il-pts--neutral">0x<');
    expect(html).toContain('il-pts--warn">1x<');
    expect(html).toContain('il-pts--loss">4x<');
  });

  it("uses plain zebra rows and highlights only a fresh newest event", () => {
    const events = [event({ timeS: 998 }), event({ timeS: 900 }), event({ timeS: 800 })];
    expect(rows(render(frame(events)))).toEqual([
      "il-row il-row--new",
      "il-row il-row--alt",
      "il-row",
    ]);
    expect(rows(render(frame(events, { tick: 1010 })))[0]).toBe("il-row");
    expect(rows(render(frame(events), { "highlight-newest": false }))[0]).toBe("il-row");
  });

  it("lists only the player's events without field events, and caps the rows", () => {
    const events = [
      event({}),
      event({ carIdx: 0, own: true, points: 1, timeS: 40 }),
      event({ timeS: 30 }),
    ];
    const own = render(frame(events), { "field-events": false });
    expect(own).toContain("· Own Events<");
    expect(rows(own)).toHaveLength(1);
    expect(own).toContain("Showing 1 record<");
    expect(rows(render(frame(events), { rows: 2 }))).toHaveLength(2);
  });

  it("hides corner labels from the settings", () => {
    const html = render(frame([event({ corner: 4 })]), { "corner-labels": false });
    expect(html).toContain("· Off track<");
    expect(html).not.toContain("(T4)");
  });

  it("hides the limits and the count where the sim has none (LMU)", () => {
    const html = render(frame([event({})], { own: null, pen: null, dq: null }));
    expect(html).not.toContain(">Limit<");
    expect(html).toContain(">M. Example · Field Events<");
    const partial = render(frame([], { pen: null }));
    expect(partial).toContain(">-- / 25x<");
  });

  it("says so when nothing has happened yet", () => {
    const html = render(frame([]));
    expect(html).toContain("No incidents yet");
    expect(html).toContain("Showing 0 records");
  });

  it("waits without data and shows invented sample events when editing", () => {
    expect(render(null)).toContain("Waiting for session");
    const html = render(null, {}, { editing: true });
    expect(rows(html)).toHaveLength(5);
    expect(html).toContain(">17x / 25x<");
    expect(html).not.toContain("il-row--new");
  });
});

describe("Incident Log CSS", () => {
  const css = readFileSync(join(__dirname, "incident-log.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size and the panel outline", () => {
    expect(rule(".il")).toContain("font-size: var(--ov-font-size, 14px);");
    expect(rule(".il::after")).toContain("box-shadow: inset 0 0 0 1px var(--ov-border);");
  });

  it("takes its colours only from theme tokens and locked colours", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".il-pts--warn")).toContain("var(--ov-locked-flag-yellow)");
    expect(rule(".il-pts--loss")).toContain("var(--ov-locked-loss)");
    expect(rule(".il-row--new > .il-cell")).toContain("var(--ov-locked-flag-yellow)");
  });
});
