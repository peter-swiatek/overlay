import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SettingField } from "../contract";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { fixtureFrame } from "../shared/fixtures";
import { DataFramesOverlay, tileGrid } from "./DataFramesOverlay";
import { dataFramesManifest } from "./manifest";
import { METRICS } from "./metrics";

function settingsWith(options: Record<string, number | string> = {}) {
  const base = defaultInstanceSettings(dataFramesManifest);
  return applySettingsPatch(dataFramesManifest, base, { options });
}

function render(
  f: TelemetryFrame | null,
  options: Record<string, number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <DataFramesOverlay settings={settingsWith(options)} />
    </OverlayRuntimeContext.Provider>,
  );
}

function frame(): TelemetryFrame {
  return fixtureFrame({
    playerCarIdx: 0,
    cars: [
      { carIdx: 0, classId: "gt3", className: "GT3", classColour: "#ffda59", classPosition: 3 },
      { carIdx: 1, classId: "gt3", className: "GT3", classPosition: 1 },
    ],
    conditions: { trackTempC: 31, airTempC: 22 },
    player: { brakeBias: 0.542, fuelL: 47 },
  });
}

const css = readFileSync(join(__dirname, "data-frames.css"), "utf8");
const select = (key: string) =>
  dataFramesManifest.settings.find((s) => s.key === key) as Extract<
    SettingField,
    { kind: "select" }
  >;

describe("data frames manifest", () => {
  it("is a 272 x 140 window of four tiles for both sims, off by default, and registered", () => {
    const m = dataFramesManifest;
    expect(m.id).toBe("data-frames");
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.defaultSize).toEqual({ width: 272, height: 140 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(manifestById("data-frames")).toBe(m);
    expect(moduleById("data-frames")?.Component).toBe(DataFramesOverlay);
  });

  it("has tile count, columns, gap and one metric select per tile", () => {
    const options = defaultInstanceSettings(dataFramesManifest).options;
    expect(options).toEqual({
      tiles: 4,
      columns: 2,
      gap: 12,
      "tile-1": "class-position",
      "tile-2": "brake-bias",
      "tile-3": "fuel-level",
      "tile-4": "track-temp",
      "tile-5": "last-lap",
      "tile-6": "best-lap",
      "tile-7": "remaining",
      "tile-8": "air-temp",
    });
    expect(dataFramesManifest.settings.find((s) => s.key === "tiles")).toMatchObject({
      kind: "number",
      min: 1,
      max: 8,
      step: 1,
    });
  });

  it("lists every metric in each select and marks the sim-limited ones", () => {
    const tile = select("tile-1");
    expect(tile.options.map((o) => o.value)).toEqual(METRICS.map((m) => m.id));
    expect(tile.options.find((o) => o.value === "incidents")?.sims).toEqual(["iracing"]);
    expect(tile.options.find((o) => o.value === "energy")?.sims).toEqual(["lmu"]);
    expect(tile.options.find((o) => o.value === "brake-bias")?.sims).toBeUndefined();
    expect(select("tile-8").help).toBe("Shown when Tiles is 8 or more.");
  });

  it("keeps a stored metric that is no longer valid at the tile's default", () => {
    const s = applySettingsPatch(dataFramesManifest, settingsWith(), {
      options: { "tile-1": "nope" },
    });
    expect(s.options["tile-1"]).toBe("class-position");
  });
});

describe("tileGrid", () => {
  it("takes the first N tile metrics and never more columns than tiles", () => {
    expect(tileGrid(settingsWith())).toEqual({
      metrics: ["class-position", "brake-bias", "fuel-level", "track-temp"],
      columns: 2,
      rows: 2,
      gapPx: 12,
    });
    expect(tileGrid(settingsWith({ tiles: 3, columns: 4 }))).toMatchObject({
      columns: 3,
      rows: 1,
    });
    expect(tileGrid(settingsWith({ tiles: 7, columns: 2, "tile-7": "gear" }))).toMatchObject({
      rows: 4,
    });
    expect(tileGrid(settingsWith({ tiles: 7 })).metrics[6]).toBe("remaining");
  });
});

describe("DataFramesOverlay", () => {
  it("draws the board's four tiles in edit mode without data", () => {
    const html = render(null, {}, { editing: true });
    expect(html.match(/class="dfr-tile"/g)).toHaveLength(4);
    expect(html).toContain('<span class="dfr-value dfr-pos-chip">P3</span>');
    expect(html).toContain("of 16 GT3");
    expect(html).toContain('<span class="dfr-value dfr-value--accent">54.2%</span>');
    expect(html).toContain('<span class="dfr-sub dfr-sub--loss">19.6L</span>');
    expect(html).toContain("Air 22°");
  });

  it("lays the tiles out in the column count with the gap", () => {
    const html = render(frame(), { tiles: 6, columns: 3, gap: 8 });
    expect(html.match(/class="dfr-tile"/g)).toHaveLength(6);
    expect(html).toContain("grid-template-columns:repeat(3, minmax(0, 1fr))");
    expect(html).toContain("grid-template-rows:repeat(2, minmax(0, 1fr))");
    expect(html).toContain("gap:8px");
  });

  it("shows live values, the chip in the class colour and no hash in any text", () => {
    const html = render(frame());
    expect(html).toContain("--class-color:#ffda59");
    expect(html).toContain(">P3<");
    expect(html).toContain("of 2 GT3");
    expect(html).toContain(">54.2%<");
    expect(html).toContain(">47.0 L<");
    expect(html).toContain(">31.0°<");
    expect(html).not.toMatch(/>#/);
  });

  it("shows '--' for every tile when driving with no data", () => {
    const html = render(null);
    expect(html.match(/class="dfr-value">--</g)).toHaveLength(4);
  });

  it("shows '--' for a metric the sim lacks", () => {
    const f = frame();
    f.state.sim = "lmu";
    f.state.player.incidentCount = 3;
    expect(render(f, { "tile-1": "incidents" })).toContain('<span class="dfr-value">--</span>');
  });

  it("styles with theme tokens, locked colours and em sizes only", () => {
    expect(css).toContain("font-size: var(--ov-font-size, 14px)");
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toContain("threat");
    expect(css).toMatch(/\.dfr-tile \{[^}]*background: var\(--ov-bg\)/);
  });

  it("uses a class prefix no other overlay styles (all overlay CSS shares one bundle)", () => {
    const root = join(__dirname, "..");
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === "data-frames") continue;
      for (const file of readdirSync(join(root, dir.name))) {
        if (!file.endsWith(".css")) continue;
        expect(readFileSync(join(root, dir.name, file), "utf8")).not.toMatch(/\.dfr\b/);
      }
    }
  });
});
