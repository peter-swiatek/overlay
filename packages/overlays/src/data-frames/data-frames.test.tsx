import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SettingField } from "../contract";
import { manifestById } from "../manifests";
import { moduleById } from "../modules";
import { OverlayRuntimeContext, staticRuntime, type OverlayRuntime } from "../runtime";
import {
  applySettingsPatch,
  defaultInstanceSettings,
  newInstanceSettings,
  parseOverlaySettingsFile,
  resetInstanceSettings,
} from "../settings";
import { OVERLAY_MANIFESTS } from "../manifests";
import { fixtureFrame } from "../shared/fixtures";
import { DataFramesOverlay } from "./DataFramesOverlay";
import { dataFramesManifest } from "./manifest";
import { INSTANCE_METRICS, METRICS } from "./metrics";

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
const metricSelect = dataFramesManifest.settings.find((s) => s.key === "metric") as Extract<
  SettingField,
  { kind: "select" }
>;

describe("data frame manifest", () => {
  it("is one 130 x 64 tile for both sims, off by default, and registered", () => {
    const m = dataFramesManifest;
    expect(m.id).toBe("data-frames");
    expect(m.title).toBe("Data Frame");
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.defaultSize).toEqual({ width: 130, height: 64 });
    expect(m.minSize.width).toBeLessThan(130);
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(manifestById("data-frames")).toBe(m);
    expect(moduleById("data-frames")?.Component).toBe(DataFramesOverlay);
  });

  it("has a single metric select and no grid settings", () => {
    expect(defaultInstanceSettings(dataFramesManifest).options).toEqual({
      metric: "class-position",
    });
    expect(dataFramesManifest.settings.map((s) => s.key)).toEqual(["metric"]);
  });

  it("lists every metric in the select and marks the sim-limited ones", () => {
    expect(metricSelect.options.map((o) => o.value)).toEqual(METRICS.map((m) => m.id));
    expect(metricSelect.options.find((o) => o.value === "incidents")?.sims).toEqual(["iracing"]);
    expect(metricSelect.options.find((o) => o.value === "energy")?.sims).toEqual(["lmu"]);
    expect(metricSelect.options.find((o) => o.value === "brake-bias")?.sims).toBeUndefined();
  });

  it("keeps a stored metric that is no longer valid at the default", () => {
    const s = applySettingsPatch(dataFramesManifest, settingsWith(), {
      options: { metric: "nope" },
    });
    expect(s.options["metric"]).toBe("class-position");
  });

  it("gives added instances the board's metrics, then copies the source's metric", () => {
    expect(INSTANCE_METRICS.slice(0, 4)).toEqual([
      "class-position",
      "brake-bias",
      "fuel-level",
      "track-temp",
    ]);
    const first = settingsWith({ metric: "speed" });
    const metricOf = (id: string) =>
      newInstanceSettings(dataFramesManifest, first, id).options["metric"];
    expect(metricOf("data-frames:2")).toBe("brake-bias");
    expect(metricOf("data-frames:3")).toBe("fuel-level");
    expect(metricOf("data-frames:4")).toBe("track-temp");
    expect(metricOf("data-frames:5")).toBe("last-lap");
    expect(metricOf("data-frames:9")).toBe("speed");
    expect(newInstanceSettings(dataFramesManifest, first, "data-frames:2").enabled).toBe(true);
    const changed = applySettingsPatch(
      dataFramesManifest,
      newInstanceSettings(dataFramesManifest, first, "data-frames:3"),
      { options: { metric: "gear" } },
    );
    expect(
      resetInstanceSettings(dataFramesManifest, changed, "data-frames:3").options["metric"],
    ).toBe("fuel-level");
  });

  it("migrates the earlier multi-tile settings: tile 1 becomes the metric, the grid is dropped", () => {
    const file = parseOverlaySettingsFile(
      {
        version: 1,
        overlays: {
          "data-frames": {
            enabled: true,
            options: { tiles: 6, columns: 3, gap: 8, "tile-1": "brake-bias", "tile-2": "lap" },
          },
        },
      },
      OVERLAY_MANIFESTS,
    );
    expect(file.overlays["data-frames"]?.enabled).toBe(true);
    expect(file.overlays["data-frames"]?.options).toEqual({ metric: "brake-bias" });
  });
});

describe("DataFramesOverlay", () => {
  it("draws the metric's sample tile in edit mode without data", () => {
    const html = render(null, {}, { editing: true });
    expect(html.match(/class="dfr-tile"/g)).toHaveLength(1);
    expect(html).toContain('<span class="dfr-value dfr-pos-chip">P3</span>');
    expect(html).toContain("of 16 GT3");
    const bias = render(null, { metric: "brake-bias" }, { editing: true });
    expect(bias).toContain('<span class="dfr-value dfr-value--accent">54.2%</span>');
    const fuel = render(null, { metric: "fuel-level" }, { editing: true });
    expect(fuel).toContain('<span class="dfr-sub dfr-sub--loss">19.6L</span>');
    expect(render(null, { metric: "track-temp" }, { editing: true })).toContain("Air 22°");
  });

  it("shows live values, the chip in the class colour and no hash in any text", () => {
    const html = render(frame());
    expect(html).toContain("--class-color:#ffda59");
    expect(html).toContain(">P3<");
    expect(html).toContain("of 2 GT3");
    expect(html).not.toMatch(/>#/);
    expect(render(frame(), { metric: "brake-bias" })).toContain(">54.2%<");
    expect(render(frame(), { metric: "fuel-level" })).toContain(">47.0 L<");
    expect(render(frame(), { metric: "track-temp" })).toContain(">31.0°<");
  });

  it("shows '--' when driving with no data", () => {
    const html = render(null);
    expect(html.match(/class="dfr-value">--</g)).toHaveLength(1);
  });

  it("shows '--' for a metric the sim lacks", () => {
    const f = frame();
    f.state.sim = "lmu";
    f.state.player.incidentCount = 3;
    expect(render(f, { metric: "incidents" })).toContain('<span class="dfr-value">--</span>');
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
