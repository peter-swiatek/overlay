import type { Proximity, ProximityCar, TelemetryFrame } from "@overlay/sim-core/types";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { radarManifest } from "./manifest";
import { RadarOverlay } from "./RadarOverlay";
import {
  arcPath,
  carRect,
  CENTRE,
  laneOffsetM,
  newRadarMemory,
  radarClear,
  radarView,
  SIDE_HOLD_MS,
  type RadarOptions,
} from "./view";

const OPTIONS: RadarOptions = { rangeM: 20, carLengthM: 4.5, carWidthM: 1.9 };

function near(
  carIdx: number,
  longitudinalM: number,
  side: ProximityCar["side"] = null,
  lateralM: number | null = null,
): ProximityCar {
  return { carIdx, longitudinalM, lateralM, side };
}

function frame(
  prox: Partial<Proximity> | null,
  cars: Array<{ carIdx: number; carNumber?: string; classColour?: string }> = [],
): TelemetryFrame {
  const f = fixtureFrame({ cars: [{ carIdx: 0 }, ...cars], playerCarIdx: 0 });
  f.derived.proximity =
    prox === null
      ? null
      : { carLeftRight: "clear", left: null, right: null, nearby: [], carLengthM: 4.8, ...prox };
  return f;
}

describe("radarView", () => {
  it("is null without proximity or a live frame", () => {
    expect(radarView(null, newRadarMemory(), 0, OPTIONS)).toBeNull();
    expect(radarView(frame(null), newRadarMemory(), 0, OPTIONS)).toBeNull();
    const waiting = frame({});
    waiting.status = "waiting";
    expect(radarView(waiting, newRadarMemory(), 0, OPTIONS)).toBeNull();
  });

  it("iRacing: puts a car on the called side one lane over, labelled without '#'", () => {
    const v = radarView(
      frame({ carLeftRight: "right", right: -0.4, nearby: [near(3, -1.84, "right")] }, [
        { carIdx: 3, carNumber: "#4" },
      ]),
      newRadarMemory(),
      0,
      OPTIONS,
    );
    expect(v).toEqual({
      cars: [
        {
          carIdx: 3,
          x: laneOffsetM(1.9),
          y: -1.85,
          alongside: true,
          colour: null,
          label: "4 (1.8m)",
        },
      ],
      left: false,
      right: true,
    });
    expect(laneOffsetM(1.9)).toBe(3.05);
  });

  it("iRacing: a car without a side sits in our lane, neutral and unlabelled", () => {
    const v = radarView(
      frame({ nearby: [near(2, 12)] }, [{ carIdx: 2, carNumber: "7", classColour: "#ffda59" }]),
      newRadarMemory(),
      0,
      OPTIONS,
    );
    expect(v?.cars).toEqual([
      { carIdx: 2, x: 0, y: 12, alongside: false, colour: "#ffda59", label: null },
    ]);
    expect(v?.left).toBe(false);
    expect(v?.right).toBe(false);
  });

  it("iRacing: keeps a car's lane briefly after the call ends", () => {
    const memory = newRadarMemory();
    radarView(
      frame({ carLeftRight: "left", left: 0, nearby: [near(5, 0, "left")] }),
      memory,
      0,
      OPTIONS,
    );
    const held = radarView(frame({ nearby: [near(5, 6)] }), memory, SIDE_HOLD_MS, OPTIONS);
    expect(held?.cars[0]).toMatchObject({ x: -laneOffsetM(1.9), alongside: false, label: null });
    expect(held?.left).toBe(false);
    const later = radarView(frame({ nearby: [near(5, 8)] }), memory, SIDE_HOLD_MS + 1, OPTIONS);
    expect(later?.cars[0]?.x).toBe(0);
  });

  it("LMU: uses the sideways position from the sim", () => {
    const v = radarView(
      frame({
        carLeftRight: "left",
        left: 0.1,
        nearby: [near(1, 0.5, "left", -2.6), near(2, -9, null, 0.4)],
      }),
      newRadarMemory(),
      0,
      OPTIONS,
    );
    // Furthest first, so the car alongside draws on top.
    expect(v?.cars.map((c) => [c.carIdx, c.x, c.y, c.alongside])).toEqual([
      [2, 0.4, -9, false],
      [1, -2.6, 0.5, true],
    ]);
    expect(v?.left).toBe(true);
  });

  it("drops cars outside the range ring", () => {
    const v = radarView(frame({ nearby: [near(1, 19), near(2, -21)] }), newRadarMemory(), 0, {
      ...OPTIONS,
      rangeM: 20,
    });
    expect(v?.cars.map((c) => c.carIdx)).toEqual([1]);
    expect(radarClear(v)).toBe(false);
    expect(
      radarClear(radarView(frame({ nearby: [near(2, -21)] }), newRadarMemory(), 0, OPTIONS)),
    ).toBe(true);
    expect(radarClear(null)).toBe(true);
  });

  it("an arc alone (spotter call, no car in the list) is not clear", () => {
    expect(radarClear({ cars: [], left: true, right: false })).toBe(false);
  });
});

describe("radar geometry", () => {
  it("scales cars to the range: 20 m to the 88-unit outer ring", () => {
    const r = carRect(0, 0, OPTIONS);
    expect(r.w).toBeCloseTo(8.36, 2);
    expect(r.h).toBeCloseTo(19.8, 2);
    expect(r.x + r.w / 2).toBeCloseTo(CENTRE, 6);
    expect(r.y + r.h / 2).toBeCloseTo(CENTRE, 6);
    // Ahead is up, right is right.
    const ahead = carRect(2, 10, OPTIONS);
    expect(ahead.y + ahead.h / 2).toBeCloseTo(CENTRE - 44, 2);
    expect(ahead.x + ahead.w / 2).toBeCloseTo(CENTRE + 8.8, 2);
  });

  it("draws the warning arcs as mirror images", () => {
    expect(arcPath("right")).toBe("M 160.93,64.94 A 68,68 0 0,1 160.93,155.06");
    expect(arcPath("left")).toBe("M 59.07,64.94 A 68,68 0 0,0 59.07,155.06");
  });
});

function render(f: TelemetryFrame | null, editing = false, options: Record<string, unknown> = {}) {
  const settings = defaultInstanceSettings(radarManifest);
  Object.assign(settings.options, options);
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, { editing })}>
      <RadarOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const count = (html: string, s: string) => html.split(s).length - 1;

describe("RadarOverlay", () => {
  it("is registered, off by default, 220 x 220, both sims", () => {
    expect(OVERLAY_MANIFESTS).toContain(radarManifest);
    expect(moduleById("radar")?.Component).toBe(RadarOverlay);
    expect(radarManifest.defaultEnabled).toBe(false);
    expect(radarManifest.defaultSize).toEqual({ width: 220, height: 220 });
    expect(radarManifest.sims).toEqual(["iracing", "lmu"]);
    const o = defaultInstanceSettings(radarManifest).options;
    expect(o).toEqual({
      range: 10,
      "car-length": 4.5,
      "car-width": 1.9,
      "car-labels": true,
      "hide-when-clear": true,
    });
  });

  it("draws three rings, the crosshair and the player in the accent", () => {
    const html = render(frame({ nearby: [near(2, 12)] }));
    expect(count(html, 'class="radar-ring ')).toBe(3);
    expect(count(html, 'class="radar-cross"')).toBe(2);
    expect(count(html, 'class="radar-player"')).toBe(1);
    expect(count(html, 'class="radar-car"')).toBe(1);
    expect(html).not.toContain("radar--hidden");
    expect(html).not.toContain("radar-arc");
  });

  it("marks a car alongside, its label and the arc on its side", () => {
    const html = render(
      frame({ carLeftRight: "right", right: -0.4, nearby: [near(3, -1.8, "right")] }, [
        { carIdx: 3, carNumber: "4" },
      ]),
    );
    expect(html).toContain("radar-car radar-car--alongside");
    expect(html).toContain(">4 (1.8m)</text>");
    // The label runs outwards from the car's inner edge, away from the player.
    expect(html).toMatch(/<text class="radar-label" x="[\d.]+" y="[\d.]+" text-anchor="start">/);
    expect(count(html, "radar-arc--right")).toBe(1);
    expect(html).not.toContain("radar-arc--left");
  });

  it("can hide the label", () => {
    const html = render(
      frame({ carLeftRight: "left", left: 0, nearby: [near(3, 0, "left")] }, [
        { carIdx: 3, carNumber: "4" },
      ]),
      false,
      { "car-labels": false },
    );
    expect(html).toContain("radar-arc--left");
    expect(html).not.toContain("radar-label");
  });

  it("outlines a car in its class colour", () => {
    const html = render(frame({ nearby: [near(2, 8)] }, [{ carIdx: 2, classColour: "#ff5888" }]));
    expect(html).toContain("--radar-class:#ff5888");
  });

  it("fades out when clear, unless that is turned off or editing", () => {
    expect(render(frame({}))).toContain("radar radar--hidden");
    expect(render(null)).toContain("radar radar--hidden");
    expect(render(frame({}), false, { "hide-when-clear": false })).not.toContain("radar--hidden");
    // Still hidden with no proximity at all (not in the car).
    expect(render(null, false, { "hide-when-clear": false })).toContain("radar--hidden");
    const edit = render(null, true);
    expect(edit).not.toContain("radar--hidden");
    expect(edit).toContain(">4 (1.8m)</text>");
    expect(edit).toContain("radar-arc--right");
  });

  it("styles text in em of the overlay font size and only theme or locked colours", () => {
    const css = readFileSync(new URL("./radar.css", import.meta.url), "utf8");
    expect(css).toContain("font-size: var(--ov-font-size, 14px)");
    expect(css).toMatch(/\.radar-label \{[^}]*font-size: 0\.64em/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
