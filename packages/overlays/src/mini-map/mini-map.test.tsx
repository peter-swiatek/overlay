import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame, TrackOutline } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type TrackMapData } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { miniMapManifest } from "./manifest";
import { MiniMapOverlay, NO_OUTLINE_NOTE } from "./MiniMapOverlay";
import {
  headerText,
  headingAt,
  miniFrame,
  miniLabel,
  miniLive,
  placeMiniCars,
  PLAYER_X,
  PLAYER_Y,
  rangeForZoom,
  RING_OUTER,
  roadPath,
  toView,
  type MiniCar,
} from "./view";

/** A circle of 1000 points in the unit box, starting at the top and running clockwise (y down). */
function circle(scaleM = 1000): TrackOutline {
  const points: [number, number][] = [];
  for (let k = 0; k < 1000; k++) {
    const a = (k / 1000) * 2 * Math.PI;
    points.push([0.5 + 0.5 * Math.sin(a), 0.5 - 0.5 * Math.cos(a)]);
  }
  return {
    version: 1,
    trackKey: "iracing_test-ring",
    points,
    scaleM,
    lengthM: Math.PI * scaleM,
    source: "world",
    closureErrorM: 0,
    gapPct: 0,
    bridgeM: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const TRACK: TrackMapData = { outline: circle(), corners: [] };

function frame(outlineReady = true): TelemetryFrame {
  const f = fixtureFrame({
    playerCarIdx: 0,
    cars: [
      { carIdx: 0, lapDistPct: 0.25, carNumber: "1", classColour: "#ffda59", isOnTrack: true },
      // 0.01 of a 3142 m lap = 31 m.
      { carIdx: 1, lapDistPct: 0.24, carNumber: "#4", classColour: "#33ceff", isOnTrack: true },
      {
        carIdx: 2,
        lapDistPct: 0.27,
        carNumber: "3",
        classColour: "#33ceff",
        isOnTrack: true,
        trackSurface: "offTrack",
      },
      { carIdx: 3, lapDistPct: 0.23, carNumber: "10", classColour: "#ff5c8a", isOnTrack: true },
      { carIdx: 4, lapDistPct: 0.26, carNumber: "8", isOnTrack: true, onPitRoad: true },
      { carIdx: 5, lapDistPct: 0.28, carNumber: "9", classColour: "#ffda59", isOnTrack: true },
      // Far round the lap: off the map.
      { carIdx: 6, lapDistPct: 0.75, carNumber: "6", isOnTrack: true },
      // In the garage and the pace car: never drawn.
      { carIdx: 7, lapDistPct: 0.25, carNumber: "7", isOnTrack: false },
      { carIdx: 8, lapDistPct: 0.25, carNumber: "0", isPaceCar: true, isOnTrack: true },
    ],
    gaps: [
      { carIdx: 1, gapS: 0.84, tier: "miniSector" },
      { carIdx: 2, gapS: -2.46, tier: "miniSector" },
      { carIdx: 3, gapS: 1.9, tier: "miniSector" },
      { carIdx: 4, gapS: -0.5, tier: "miniSector" },
      { carIdx: 5, gapS: null, tier: "unavailable" },
    ],
  });
  f.derived.track = {
    trackKey: "iracing_test-ring",
    outlineReady,
    pitExitLapDistPct: null,
    pitExitDistanceM: null,
  };
  f.derived.slowCar = { carIdx: 5, distanceM: 90, speedMps: 1, stopped: true };
  return f;
}

function render(
  f: TelemetryFrame | null,
  track: TrackMapData | null,
  opts: { editing?: boolean; options?: Record<string, boolean | number | string> } = {},
) {
  const settings = defaultInstanceSettings(miniMapManifest);
  Object.assign(settings.options, opts.options ?? {});
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider
      value={staticRuntime(f, { editing: opts.editing ?? false }, track)}
    >
      <MiniMapOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const labels = (html: string) =>
  [...html.matchAll(/class="mini-map-label"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe("manifest", () => {
  it("is registered, off by default, 240 x 240 in both sims", () => {
    expect(OVERLAY_MANIFESTS).toContain(miniMapManifest);
    expect(moduleById("mini-map")?.manifest).toBe(miniMapManifest);
    expect(miniMapManifest.defaultEnabled).toBe(false);
    expect(miniMapManifest.defaultSize).toEqual({ width: 240, height: 240 });
    expect(miniMapManifest.sims).toEqual(["iracing", "lmu"]);
    expect(defaultInstanceSettings(miniMapManifest).options).toEqual({
      zoom: 150,
      orientation: "heading-up",
      "car-labels": true,
      gap: true,
    });
  });
});

describe("miniLive", () => {
  it("splits off the player, drops garage and pace cars, reads status and gap, no closeness colour", () => {
    const live = miniLive(frame());
    expect(live.playerPct).toBe(0.25);
    expect(live.trackKey).toBe("iracing_test-ring");
    expect(live.outlineReady).toBe(true);
    const byIdx = new Map(live.cars.map((c) => [c.carIdx, c]));
    expect([...byIdx.keys()]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(byIdx.get(1)).toMatchObject({ number: "4", status: null, gapS: 0.8 });
    expect(byIdx.get(2)).toMatchObject({ number: "3", status: "off", gapS: -2.5 });
    expect(byIdx.get(3)).toMatchObject({ status: null, gapS: 1.9 });
    expect(byIdx.get(4)).toMatchObject({ status: "pit" });
    for (const c of live.cars) expect(c).not.toHaveProperty("threat");
    expect(byIdx.get(5)).toMatchObject({ status: "slow", gapS: null });
  });

  it("is empty when not live", () => {
    expect(miniLive(null).playerPct).toBeNull();
    const waiting = frame();
    waiting.status = "waiting";
    expect(miniLive(waiting).cars).toEqual([]);
  });
});

describe("geometry", () => {
  const outline = circle();

  it("follows the outline's direction of travel", () => {
    // Clockwise from the top on a y-down plane: right at the top, down at the right side.
    const [x0, y0] = headingAt(outline, 0);
    expect(x0).toBeCloseTo(1, 3);
    expect(y0).toBeCloseTo(0, 3);
    const [x1, y1] = headingAt(outline, 0.25);
    expect(x1).toBeCloseTo(0, 3);
    expect(y1).toBeCloseTo(1, 3);
  });

  it("scales the outer ring to the zoom's range", () => {
    expect(rangeForZoom(100)).toBe(300);
    expect(rangeForZoom(150)).toBe(200);
    expect(rangeForZoom(300)).toBe(100);
  });

  it("heading up: the player at the marker, the road ahead straight up", () => {
    const f = miniFrame(outline, 0.25, { zoomPct: 150, headingUp: true });
    const [px, py] = toView(f, [1, 0.5]);
    expect(px).toBeCloseTo(PLAYER_X, 6);
    expect(py).toBeCloseTo(PLAYER_Y, 6);
    // 200 m further along the tangent is on the outer ring, straight ahead.
    const ahead = toView(f, [1, 0.5 + 200 / 1000]);
    expect(ahead[0]).toBeCloseTo(PLAYER_X, 6);
    expect(ahead[1]).toBeCloseTo(PLAYER_Y - RING_OUTER, 6);
    // The circle's centre is to the player's right (clockwise lap), never mirrored.
    expect(toView(f, [0.5, 0.5])[0]).toBeGreaterThan(PLAYER_X);
  });

  it("north up keeps the outline's orientation", () => {
    const f = miniFrame(outline, 0.25, { zoomPct: 100, headingUp: false });
    const [x, y] = toView(f, [1, 0.4]);
    expect(x).toBeCloseTo(PLAYER_X, 6);
    expect(y).toBeLessThan(PLAYER_Y);
  });

  it("draws only the stretch of road near the player, the whole loop when it all fits", () => {
    const near = roadPath(outline, miniFrame(outline, 0.25, { zoomPct: 150, headingUp: true }));
    expect(near.startsWith("M")).toBe(true);
    expect(near).not.toContain("Z");
    expect(near.split("L").length).toBeLessThan(400);
    const small = circle(50);
    const all = roadPath(small, miniFrame(small, 0.25, { zoomPct: 100, headingUp: true }));
    expect(all.endsWith("Z")).toBe(true);
    expect(all.split("L").length).toBe(1000);
  });

  it("places only cars inside the view; labels run away from the right edge", () => {
    const live = miniLive(frame());
    const f = miniFrame(outline, 0.25, { zoomPct: 150, headingUp: true });
    const placed = placeMiniCars(outline, f, live.cars, { labels: true, gaps: true });
    expect(placed.map((c) => c.carIdx)).toEqual([4, 1, 3, 2, 5]);
    for (const c of placed) {
      expect(c.anchor === "end" ? c.labelX < c.x : c.labelX > c.x).toBe(true);
    }
    const behind = placed.find((c) => c.carIdx === 1)!;
    expect(behind.y).toBeGreaterThan(PLAYER_Y);
    expect(Math.abs(behind.x - PLAYER_X)).toBeLessThan(2);
  });
});

describe("labels", () => {
  const car: MiniCar = {
    carIdx: 1,
    pct: 0,
    number: "3",
    colour: null,
    status: "off",
    gapS: -2.5,
  };

  it("reads number, status and gap without a '#'", () => {
    expect(miniLabel(car, true)).toBe("3 OFF (-2.5s)");
    expect(miniLabel({ ...car, status: null, gapS: 0.8 }, true)).toBe("3 (+0.8s)");
    expect(miniLabel(car, false)).toBe("3 OFF");
    expect(miniLabel({ ...car, number: null, status: null }, false)).toBeNull();
    expect(miniLabel({ ...car, status: "slow", gapS: null }, true)).toBe("3 SLOW");
  });

  it("says zoom and orientation in the header", () => {
    expect(headerText({ zoomPct: 150, headingUp: true })).toBe("ZOOM 150% · HEADING UP");
    expect(headerText({ zoomPct: 200, headingUp: false })).toBe("ZOOM 200% · NORTH UP");
  });
});

describe("MiniMapOverlay", () => {
  it("draws the road, the player ring and labelled cars with their colours", () => {
    const html = render(frame(), TRACK);
    expect(html).toContain('class="mini-map-road"');
    expect(html).toContain('class="mini-map-road-casing"');
    expect(html).not.toContain("centre-line");
    expect(html).toContain('class="mini-map-player-ring"');
    expect(html).toContain("ZOOM 150% · HEADING UP");
    expect(labels(html)).toEqual([
      "8 PIT (-0.5s)",
      "4 (+0.8s)",
      "10 (+1.9s)",
      "3 OFF (-2.5s)",
      "9 SLOW",
    ]);
    expect(html).not.toContain("#4");
    expect(html).not.toContain("threat");
    expect(readFileSync(join(__dirname, "mini-map.css"), "utf8")).not.toContain("threat");
    expect(html.match(/mini-map-car mini-map-car--class/g)).toHaveLength(3);
    expect(html).toContain("mini-map-car mini-map-car--flag");
    expect(html).toContain("mini-map-car--pit");
    expect(html).toContain("--mini-map-class:#ff5c8a");
    expect(html).not.toContain(NO_OUTLINE_NOTE);
  });

  it("follows the label and gap settings", () => {
    expect(labels(render(frame(), TRACK, { options: { gap: false } }))).toContain("3 OFF");
    expect(labels(render(frame(), TRACK, { options: { "car-labels": false } }))).toEqual([]);
    expect(render(frame(), TRACK, { options: { zoom: 200, orientation: "north-up" } })).toContain(
      "ZOOM 200% · NORTH UP",
    );
  });

  it("shows only the learning note while driving without an outline", () => {
    const html = render(frame(false), TRACK);
    expect(html).toContain(NO_OUTLINE_NOTE);
    expect(html).not.toContain("mini-map-road");
    expect(html).not.toContain("mini-map-player-ring");
  });

  it("draws the sample with the note while editing without an outline", () => {
    const html = render(frame(false), TRACK, { editing: true });
    expect(html).toContain(NO_OUTLINE_NOTE);
    expect(html).toContain("mini-map-road");
    expect(labels(html)).toContain("3 OFF (-2.5s)");
  });

  it("uses the sample without a note in hosts that cannot fetch outlines", () => {
    const settings = defaultInstanceSettings(miniMapManifest);
    const html = renderToStaticMarkup(
      <OverlayRuntimeContext.Provider
        value={{ ...staticRuntime(null), useTrackOutline: undefined }}
      >
        <MiniMapOverlay settings={settings} />
      </OverlayRuntimeContext.Provider>,
    );
    expect(html).toContain("mini-map-road");
    expect(html).not.toContain(NO_OUTLINE_NOTE);
  });
});
