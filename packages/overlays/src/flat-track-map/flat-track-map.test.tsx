import type { TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { flatTrackMapManifest } from "./manifest";
import { FlatTrackMapOverlay } from "./FlatTrackMapOverlay";
import {
  barLabels,
  DEFAULT_BAR_EM,
  flatLive,
  innerBoundaries,
  orderCars,
  playerLabel,
  playerText,
  sectorLabels,
} from "./view";

function frame(sectorStartPcts: number[] | null = [0, 0.27, 0.53, 0.78]): TelemetryFrame {
  const f = fixtureFrame({
    playerCarIdx: 0,
    session: { sectorStartPcts },
    cars: [
      { carIdx: 0, lapDistPct: 0.46, carNumber: "#1", classColour: "#ffda59", isOnTrack: true },
      { carIdx: 1, lapDistPct: 0.2, carNumber: "4", classColour: "#33ceff", isOnTrack: true },
      {
        carIdx: 2,
        lapDistPct: 0.6,
        carNumber: "3",
        classColour: "#33ceff",
        isOnTrack: true,
        trackSurface: "offTrack",
      },
      { carIdx: 3, lapDistPct: 0.9, carNumber: "8", isOnTrack: true, onPitRoad: true },
      { carIdx: 4, lapDistPct: 0.7, carNumber: "9", classColour: "#ff5c8a", isOnTrack: true },
      // In the garage, out of the world, and the pace car: never drawn.
      { carIdx: 5, lapDistPct: 0.3, carNumber: "5", isOnTrack: false },
      { carIdx: 6, lapDistPct: 0.3, carNumber: "6", trackSurface: "notInWorld" },
      { carIdx: 7, lapDistPct: 0.3, carNumber: "0", isPaceCar: true, isOnTrack: true },
    ],
  });
  f.derived.slowCar = { carIdx: 4, distanceM: 90, speedMps: 1, stopped: true };
  return f;
}

function render(
  f: TelemetryFrame | null,
  opts: { editing?: boolean; options?: Record<string, boolean | number | string> } = {},
) {
  const settings = defaultInstanceSettings(flatTrackMapManifest);
  Object.assign(settings.options, opts.options ?? {});
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, { editing: opts.editing ?? false })}>
      <FlatTrackMapOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const labelTexts = (html: string) =>
  [...html.matchAll(/class="flat-track-map-label [^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]);
const count = (html: string, cls: string) =>
  html.split(new RegExp(`class="[^"]*\\b${cls}\\b`)).length - 1;

describe("manifest", () => {
  it("is registered, off by default, 480 x 44 in both sims", () => {
    expect(OVERLAY_MANIFESTS).toContain(flatTrackMapManifest);
    expect(moduleById("flat-track-map")?.manifest).toBe(flatTrackMapManifest);
    expect(flatTrackMapManifest.defaultEnabled).toBe(false);
    expect(flatTrackMapManifest.defaultSize).toEqual({ width: 480, height: 44 });
    expect(flatTrackMapManifest.sims).toEqual(["iracing", "lmu"]);
    expect(defaultInstanceSettings(flatTrackMapManifest).options).toEqual({
      labels: true,
      "sector-ticks": true,
      "player-label": true,
    });
  });
});

describe("flatLive", () => {
  it("keeps cars in the world, reads pit, off-track and slow, drops the '#'", () => {
    const live = flatLive(frame());
    expect(live.sectorStartPcts).toEqual([0, 0.27, 0.53, 0.78]);
    const byIdx = new Map(live.cars.map((c) => [c.carIdx, c]));
    expect([...byIdx.keys()]).toEqual([0, 1, 2, 3, 4]);
    expect(byIdx.get(0)).toMatchObject({ player: true, number: "1", pct: 0.46 });
    expect(byIdx.get(1)).toMatchObject({ flag: false, pit: false });
    expect(byIdx.get(2)).toMatchObject({ flag: true, pit: false });
    expect(byIdx.get(3)).toMatchObject({ flag: false, pit: true });
    expect(byIdx.get(4)).toMatchObject({ flag: true });
  });

  it("is empty when not live", () => {
    expect(flatLive(null).cars).toEqual([]);
    const waiting = frame();
    waiting.status = "waiting";
    expect(flatLive(waiting).cars).toEqual([]);
  });

  it("draws pit cars first and the player last", () => {
    expect(orderCars(flatLive(frame()).cars).map((c) => c.carIdx)).toEqual([3, 1, 2, 4, 0]);
  });
});

describe("sectors", () => {
  it("keeps the inner boundaries, sorted and distinct", () => {
    expect(innerBoundaries([0, 0.53, 0.27, 0.78, 0.27, 1, Number.NaN])).toEqual([0.27, 0.53, 0.78]);
    expect(innerBoundaries(null)).toEqual([]);
  });

  it("names each sector where it ends, S/F at the start", () => {
    expect(sectorLabels([0, 0.27, 0.53, 0.78]).map((l) => [l.text, l.pct, l.anchor])).toEqual([
      ["S/F", 0, "start"],
      ["S1", 0.27, "middle"],
      ["S2", 0.53, "middle"],
      ["S3", 0.78, "middle"],
      ["S4", 1, "end"],
    ]);
    expect(sectorLabels(null).map((l) => l.text)).toEqual(["S/F"]);
    expect(sectorLabels([0]).map((l) => l.text)).toEqual(["S/F"]);
  });
});

describe("player label", () => {
  it("reads number, YOU and the floored lap share", () => {
    expect(playerText({ number: "1", pct: 0.468 })).toBe("1 YOU (46%)");
    expect(playerText({ number: null, pct: 0.05 })).toBe("YOU (5%)");
    expect(playerText({ number: "7", pct: 0.9999 })).toBe("7 YOU (99%)");
  });

  it("stays inside the bar near either end", () => {
    expect(playerLabel({ number: "1", pct: 0.5 }, DEFAULT_BAR_EM).anchor).toBe("middle");
    expect(playerLabel({ number: "1", pct: 0.01 }, DEFAULT_BAR_EM)).toMatchObject({
      pct: 0,
      anchor: "start",
    });
    expect(playerLabel({ number: "1", pct: 0.99 }, DEFAULT_BAR_EM)).toMatchObject({
      pct: 1,
      anchor: "end",
    });
  });

  it("hides the sector labels it would overlap", () => {
    const sectors = sectorLabels([0, 0.27, 0.53, 0.78]);
    const texts = (pct: number) =>
      barLabels(sectors, playerLabel({ number: "1", pct }, DEFAULT_BAR_EM), DEFAULT_BAR_EM).map(
        (l) => l.text,
      );
    expect(texts(0.4)).toEqual(["1 YOU (40%)", "S/F", "S1", "S2", "S3", "S4"]);
    expect(texts(0.5)).toEqual(["1 YOU (50%)", "S/F", "S1", "S3", "S4"]);
    expect(texts(0.02)).toEqual(["1 YOU (2%)", "S1", "S2", "S3", "S4"]);
    expect(barLabels(sectors, null, DEFAULT_BAR_EM)).toHaveLength(5);
  });

  it("drops a sector label that would sit on another in a short sector", () => {
    const sectors = sectorLabels([0, 0.5, 0.51]);
    expect(barLabels(sectors, null, DEFAULT_BAR_EM).map((l) => l.text)).toEqual([
      "S/F",
      "S1",
      "S3",
    ]);
  });
});

describe("FlatTrackMapOverlay", () => {
  it("draws the bar, ticks, class-coloured dots, the player ring and labels", () => {
    const html = render(frame());
    expect(count(html, "flat-track-map-tick--start")).toBe(1);
    expect(count(html, "flat-track-map-tick--sector")).toBe(3);
    expect(count(html, "flat-track-map-car")).toBe(5);
    expect(count(html, "flat-track-map-car--player")).toBe(1);
    expect(count(html, "flat-track-map-car--flag")).toBe(2);
    expect(count(html, "flat-track-map-car--pit")).toBe(1);
    expect(html).toContain("--flat-track-map-class:#33ceff");
    expect(html).toContain("left:46%");
    expect(labelTexts(html)).toEqual(["1 YOU (46%)", "S/F", "S1", "S3", "S4"]);
    expect(html).not.toContain("#1");
  });

  it("follows the label, tick and player-label settings", () => {
    const noTicks = render(frame(), { options: { "sector-ticks": false } });
    expect(count(noTicks, "flat-track-map-tick--sector")).toBe(0);
    expect(labelTexts(noTicks)).toEqual(["1 YOU (46%)", "S/F"]);
    const noLabels = render(frame(), { options: { labels: false } });
    expect(labelTexts(noLabels)).toEqual(["1 YOU (46%)"]);
    expect(count(noLabels, "flat-track-map-tick--sector")).toBe(3);
    const noPlayer = render(frame(), { options: { "player-label": false } });
    expect(labelTexts(noPlayer)).toEqual(["S/F", "S1", "S2", "S3", "S4"]);
    const none = render(frame(), { options: { labels: false, "player-label": false } });
    expect(none).not.toContain("flat-track-map-labels");
  });

  it("shows only S/F without sector boundaries", () => {
    const html = render(frame(null));
    expect(count(html, "flat-track-map-tick--sector")).toBe(0);
    expect(labelTexts(html)).toEqual(["1 YOU (46%)", "S/F"]);
  });

  it("draws the sample while editing with no cars, and an empty bar while driving", () => {
    const editing = render(null, { editing: true });
    expect(editing).toContain("flat-track-map--sample");
    expect(labelTexts(editing)).toContain("1 YOU (46%)");
    const idle = render(null);
    expect(idle).not.toContain("flat-track-map--sample");
    expect(count(idle, "flat-track-map-car")).toBe(0);
  });
});
