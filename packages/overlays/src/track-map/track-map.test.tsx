import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame, TrackOutline } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureFrame } from "../shared/fixtures";
import { defaultInstanceSettings } from "../settings";
import { OverlayRuntimeContext, staticRuntime, type TrackMapData } from "../runtime";
import { trackMapManifest } from "./manifest";
import { SAMPLE_CARS, SAMPLE_TRACK } from "./sample";
import { NO_OUTLINE_NOTE, TrackMapOverlay } from "./TrackMapOverlay";
import {
  carLabel,
  cornerLabels,
  cornerMidPct,
  mapLive,
  mapShape,
  mapTicks,
  placeAt,
  placeCars,
  VIEW_H,
  VIEW_W,
} from "./view";

/** A circle of 1000 points in the unit box, starting at the top and running clockwise. */
function circle(): TrackOutline {
  const points: [number, number][] = [];
  for (let k = 0; k < 1000; k++) {
    const a = (k / 1000) * 2 * Math.PI;
    points.push([0.5 + 0.5 * Math.sin(a), 0.5 - 0.5 * Math.cos(a)]);
  }
  return {
    version: 1,
    trackKey: "iracing_test-ring",
    points,
    scaleM: 1000,
    lengthM: 3141,
    source: "world",
    closureErrorM: 0,
    gapPct: 0,
    bridgeM: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const TRACK: TrackMapData = {
  outline: circle(),
  corners: [
    { number: 1, startPct: 0.2, endPct: 0.3 },
    { number: 2, startPct: 0.95, endPct: 0.05 },
  ],
};

function frame(outlineReady = true): TelemetryFrame {
  const f = fixtureFrame({
    playerCarIdx: 0,
    session: { sectorStartPcts: [0, 0.33, 0.66] },
    cars: [
      { carIdx: 0, lapDistPct: 0.5, carNumber: "1", classColour: "#ffda59", isOnTrack: true },
      { carIdx: 1, lapDistPct: 0.1, carNumber: "#7", classColour: "#33ceff", isOnTrack: true },
      { carIdx: 2, lapDistPct: 0.6, carNumber: "22", classColour: null, isOnTrack: true },
      {
        carIdx: 3,
        lapDistPct: 0.8,
        carNumber: "48",
        classColour: "#ffda59",
        isOnTrack: true,
        onPitRoad: true,
      },
      { carIdx: 4, lapDistPct: 0.7, carNumber: "9", classColour: "#33ceff", isOnTrack: true },
      // In the garage: not drawn.
      { carIdx: 5, lapDistPct: 0.2, carNumber: "5", isOnTrack: false },
      // The pace car: not drawn.
      { carIdx: 6, lapDistPct: 0.3, carNumber: "0", isPaceCar: true, isOnTrack: true },
    ],
  });
  f.derived.track = {
    trackKey: "iracing_test-ring",
    outlineReady,
    pitExitLapDistPct: null,
    pitExitDistanceM: null,
  };
  f.derived.slowCar = { carIdx: 4, distanceM: 400, speedMps: 1, stopped: true };
  return f;
}

function render(
  f: TelemetryFrame | null,
  track: TrackMapData | null,
  opts: { editing?: boolean; options?: Record<string, boolean> } = {},
) {
  const settings = defaultInstanceSettings(trackMapManifest);
  Object.assign(settings.options, opts.options ?? {});
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider
      value={staticRuntime(f, { editing: opts.editing ?? false }, track)}
    >
      <TrackMapOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const count = (html: string, s: string) => html.split(s).length - 1;
const texts = (html: string, cls: string) =>
  [...html.matchAll(new RegExp(`class="${cls}"[^>]*>([^<]*)<`, "g"))].map((m) => m[1]);

describe("mapLive", () => {
  it("keeps cars in the world, flags pit, slow and player, strips '#'", () => {
    const live = mapLive(frame());
    expect(live.trackKey).toBe("iracing_test-ring");
    expect(live.outlineReady).toBe(true);
    expect(live.sectorStartPcts).toEqual([0, 0.33, 0.66]);
    expect(live.cars.map((c) => c.carIdx)).toEqual([0, 1, 2, 3, 4]);
    expect(live.cars.find((c) => c.carIdx === 1)?.label).toBe("7");
    expect(live.cars.find((c) => c.carIdx === 3)?.pit).toBe(true);
    expect(live.cars.find((c) => c.carIdx === 4)?.slow).toBe(true);
    expect(live.cars.filter((c) => c.player).map((c) => c.carIdx)).toEqual([0]);
  });

  it("is empty when not live", () => {
    expect(mapLive(null).cars).toEqual([]);
    expect(mapLive({ ...frame(), status: "waiting" }).trackKey).toBeNull();
  });
});

describe("geometry", () => {
  const shape = mapShape(TRACK.outline);

  it("fits the outline inside the view box", () => {
    const xs = TRACK.outline.points.map((_, k) => placeAt(shape, k / 1000));
    for (const [x, y] of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(VIEW_W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(VIEW_H);
    }
    expect(shape.path.startsWith("M")).toBe(true);
    expect(shape.path.endsWith("Z")).toBe(true);
  });

  it("draws ticks across the ribbon, about 14 units long", () => {
    const [start] = mapTicks(shape, null);
    // At pct 0 the circle runs to the right, so the tick is vertical.
    expect(start!.x1).toBeCloseTo(start!.x2, 0);
    expect(Math.hypot(start!.x2 - start!.x1, start!.y2 - start!.y1)).toBeCloseTo(14, 0);
  });

  it("puts corner labels outside the ribbon and handles a corner across the line", () => {
    expect(cornerMidPct({ number: 1, startPct: 0.95, endPct: 0.05 })).toBeCloseTo(0, 6);
    const [c1] = cornerLabels(shape, TRACK.corners);
    const [px, py] = placeAt(shape, 0.25);
    const d = (x: number, y: number) => Math.hypot(x - shape.centroid[0], y - shape.centroid[1]);
    expect(d(c1!.x, c1!.y)).toBeGreaterThan(d(px, py) + 10);
    expect(c1!.text).toBe("T1");
  });

  it("orders pit cars first and the player last", () => {
    const placed = placeCars(shape, SAMPLE_CARS);
    expect(placed[0]!.pit).toBe(true);
    expect(placed.at(-1)!.player).toBe(true);
    expect(placed.at(-2)!.slow).toBe(true);
  });

  it("strips '#' from car numbers", () => {
    expect(carLabel("#12")).toBe("12");
    expect(carLabel(" 7 ")).toBe("7");
    expect(carLabel("#")).toBeNull();
    expect(carLabel(null)).toBeNull();
  });
});

describe("TrackMapOverlay", () => {
  it("draws the casing under the surface ribbon", () => {
    const html = render(frame(), TRACK);
    expect(count(html, 'class="track-map-casing"')).toBe(1);
    expect(count(html, 'class="track-map-surface"')).toBe(1);
    expect(html.indexOf("track-map-casing")).toBeLessThan(html.indexOf("track-map-surface"));
    expect(html).toContain('viewBox="0 0 320 240"');
  });

  it("draws one start/finish tick and one tick per sector start other than 0", () => {
    const html = render(frame(), TRACK);
    expect(count(html, "track-map-tick--start")).toBe(1);
    expect(count(html, "track-map-tick--sector")).toBe(2);
  });

  it("colours car dots by class, falling back to the accent", () => {
    const html = render(frame(), TRACK);
    expect(count(html, 'class="track-map-dot"')).toBe(3);
    expect(html).toContain("fill:#33ceff");
    expect(html).toContain("fill:var(--ov-accent)");
    expect(count(html, "track-map-player-dot")).toBe(1);
  });

  it("labels cars with their number and never a '#'", () => {
    const html = render(frame(), TRACK);
    expect(texts(html, "track-map-label")).toEqual(["48", "7", "22"]);
    expect(texts(html, "track-map-player-label")).toEqual(["1 YOU"]);
    expect(html).not.toContain("#7");
    expect(html).not.toMatch(/>[^<]*#[^<]*</);
  });

  it("drops the numbers but keeps YOU when car numbers are off", () => {
    const html = render(frame(), TRACK, { options: { "car-numbers": false } });
    expect(count(html, 'class="track-map-label"')).toBe(0);
    expect(texts(html, "track-map-player-label")).toEqual(["YOU"]);
  });

  it("draws the player last, with its ring", () => {
    const html = render(frame(), TRACK);
    expect(count(html, "track-map-player-ring")).toBe(1);
    const lastCar = html.lastIndexOf('<g class="track-map-car');
    expect(html.indexOf('<g class="track-map-car track-map-car--player"')).toBe(lastCar);
  });

  it("dims cars in the pit lane", () => {
    const html = render(frame(), TRACK);
    expect(count(html, "track-map-car--pit")).toBe(1);
    expect(html).toMatch(/track-map-car--pit"><circle[^>]*fill:#ffda59/);
  });

  it("marks the slow car with a yellow ring and label", () => {
    const html = render(frame(), TRACK);
    expect(count(html, "track-map-slow-ring")).toBe(1);
    expect(texts(html, "track-map-slow-label")).toEqual(["9 YLW"]);
  });

  describe("lapped cars", () => {
    const lapped = (): TelemetryFrame => {
      const f = frame();
      f.derived.gaps = [
        { carIdx: 1, gapS: 1, tier: "position", lapDelta: 1 },
        { carIdx: 2, gapS: 1, tier: "position", lapDelta: -1 },
        { carIdx: 3, gapS: 1, tier: "position", lapDelta: 0 },
        { carIdx: 4, gapS: 1, tier: "position", lapDelta: null },
      ];
      return f;
    };

    it("reads the lap mark from the derived lap delta, never for the player", () => {
      const marks = Object.fromEntries(mapLive(lapped()).cars.map((c) => [c.carIdx, c.lap]));
      expect(marks).toEqual({ 0: null, 1: "ahead", 2: "behind", 3: null, 4: null });
      expect(mapLive(frame()).cars.every((c) => c.lap === null)).toBe(true);
    });

    it("rings lapped cars and follows the mark-lapped setting", () => {
      const html = render(lapped(), TRACK);
      expect(count(html, 'class="track-map-lap-ring"')).toBe(2);
      expect(count(html, "track-map-car--lap-ahead")).toBe(1);
      expect(count(html, "track-map-car--lap-behind")).toBe(1);
      const off = render(lapped(), TRACK, { options: { "mark-lapped": false } });
      expect(off).not.toContain("track-map-lap-ring");
      expect(off).not.toContain("track-map-car--lap-");
    });

    it("rings in the locked lap colours and dims a car you have lapped", () => {
      const css = readFileSync(join(__dirname, "track-map.css"), "utf8");
      expect(css).toMatch(
        /\.track-map-car--lap-ahead \.track-map-lap-ring \{\s*stroke: var\(--ov-locked-lap-ahead\);/,
      );
      expect(css).toMatch(
        /\.track-map-car--lap-behind \.track-map-lap-ring \{\s*stroke: var\(--ov-locked-lap-behind\);/,
      );
      expect(css).toMatch(/\.track-map-car--lap-behind \{\s*opacity: 0\.6;/);
    });
  });

  it("shows corner labels unless turned off", () => {
    expect(count(render(frame(), TRACK), 'class="track-map-corner"')).toBe(2);
    const off = render(frame(), TRACK, { options: { "corner-labels": false } });
    expect(count(off, "track-map-corner")).toBe(0);
    expect(count(render(frame(), { ...TRACK, corners: [] }), "track-map-corner")).toBe(0);
  });

  it("renders nothing while driving without an outline", () => {
    expect(render(frame(false), TRACK)).toBe("");
    expect(render(frame(), null)).toBe("");
    expect(render(null, null)).toBe("");
  });

  it("shows the sample track, cars and a note while editing without an outline", () => {
    const html = render(null, null, { editing: true });
    expect(html).toContain("track-map--sample");
    expect(count(html, 'class="track-map-casing"')).toBe(1);
    expect(count(html, "track-map-player-ring")).toBe(1);
    expect(count(html, '<g class="track-map-car')).toBe(SAMPLE_CARS.length);
    expect(count(html, "track-map-car--lap-ahead")).toBe(1);
    expect(count(html, "track-map-car--lap-behind")).toBe(1);
    expect(count(html, 'class="track-map-corner"')).toBe(SAMPLE_TRACK.corners.length);
    expect(texts(html, "track-map-note")).toEqual([NO_OUTLINE_NOTE]);
  });

  it("shows the real track while editing once the outline is known", () => {
    const html = render(frame(), TRACK, { editing: true });
    expect(html).not.toContain("track-map--sample");
    expect(count(html, "track-map-note")).toBe(0);
  });

  it("uses the sample track in hosts that cannot fetch outlines", () => {
    const runtime = { ...staticRuntime(frame(false)), useTrackOutline: undefined };
    const html = renderToStaticMarkup(
      <OverlayRuntimeContext.Provider value={runtime}>
        <TrackMapOverlay settings={defaultInstanceSettings(trackMapManifest)} />
      </OverlayRuntimeContext.Provider>,
    );
    expect(count(html, 'class="track-map-casing"')).toBe(1);
    expect(texts(html, "track-map-player-label")).toEqual(["1 YOU"]);
  });
});

describe("sample track", () => {
  it("is a full outline with corners in driving order", () => {
    expect(SAMPLE_TRACK.outline.points).toHaveLength(1000);
    for (const [x, y] of SAMPLE_TRACK.outline.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    const mids = SAMPLE_TRACK.corners.map(cornerMidPct);
    expect([...mids].sort((a, b) => a - b)).toEqual(mids);
  });
});
