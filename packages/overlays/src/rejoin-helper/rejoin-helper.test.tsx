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
import { RejoinHelperOverlay } from "./RejoinHelperOverlay";
import { rejoinHelperManifest } from "./manifest";

function render(
  f: TelemetryFrame | null,
  options: Record<string, boolean | number | string> = {},
  runtime: Partial<OverlayRuntime> = {},
): string {
  const base = defaultInstanceSettings(rejoinHelperManifest);
  const settings = applySettingsPatch(rejoinHelperManifest, base, { options });
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, runtime)}>
      <RejoinHelperOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

/** The player driving at speed with one car `gapS` behind (null: none). */
function frame(gapS: number | null): TelemetryFrame {
  return fixtureFrame({
    cars: [
      { carIdx: 0, lapDistPct: 0.5, trackSurface: "onTrack" },
      { carIdx: 1, lapDistPct: 0.48, trackSurface: "onTrack" },
    ],
    playerCarIdx: 0,
    gaps: gapS === null ? [] : [{ carIdx: 1, gapS, tier: "position" }],
    player: { speedMps: 50, trackSurface: "onTrack", isOnTrack: true },
    session: { phase: "racing" },
  });
}

const ALWAYS = { "always-show": true };

describe("rejoin helper manifest", () => {
  it("is a 196 x 50 panel for both sims, off by default, and registered", () => {
    const m = rejoinHelperManifest;
    expect(m.id).toBe("rejoin-helper");
    expect(m.sims).toEqual(["iracing", "lmu"]);
    expect(m.defaultSize).toEqual({ width: 196, height: 50 });
    expect(m.defaultEnabled).toBe(false);
    expect(defaultInstanceSettings(m).enabled).toBe(false);
    expect(defaultInstanceSettings(m).options).toEqual({
      "red-seconds": 2,
      "caution-seconds": 5,
      "always-show": false,
    });
    expect(manifestById("rejoin-helper")).toBe(m);
    expect(moduleById("rejoin-helper")?.Component).toBe(RejoinHelperOverlay);
  });
});

describe("RejoinHelperOverlay", () => {
  it("shows the gap, a divider, the label and the condition in one row", () => {
    const html = render(frame(1.4), ALWAYS);
    expect(html).toBe(
      '<div class="rj rj--red"><span class="rj-gap">1.4<small>s</small></span>' +
        '<i class="rj-div"></i><span class="rj-txt"><span class="rj-label">NEXT CAR</span>' +
        '<b class="rj-condition">DO NOT REJOIN</b></span></div>',
    );
  });

  it("colours by the thresholds, which are settings", () => {
    expect(render(frame(4.2), ALWAYS)).toContain('class="rj rj--yellow"');
    expect(render(frame(4.2), ALWAYS)).toContain(">CAUTION<");
    expect(render(frame(8), ALWAYS)).toContain('class="rj rj--clear"');
    expect(render(frame(8), ALWAYS)).toContain(">CLEAR TO REJOIN<");
    expect(render(frame(4.2), { ...ALWAYS, "red-seconds": 5, "caution-seconds": 8 })).toContain(
      "rj--red",
    );
  });

  it("shows green with -- and no unit when no car is behind", () => {
    const html = render(frame(null), ALWAYS);
    expect(html).toContain('class="rj rj--clear"');
    expect(html).toContain('<span class="rj-gap">--</span>');
  });

  it("is empty while driving, without a frame, and shows the red sample when editing", () => {
    expect(render(frame(1.4))).toBe("");
    expect(render(null)).toBe("");
    for (const f of [null, frame(8)]) {
      const html = render(f, {}, { editing: true });
      expect(html).toContain('class="rj rj--red"');
      expect(html).toContain("1.4<small>s</small>");
      expect(html).toContain(">DO NOT REJOIN<");
    }
  });
});

describe("Rejoin Helper CSS", () => {
  const css = readFileSync(join(__dirname, "rejoin-helper.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("uses the theme text size", () => {
    expect(rule(".rj")).toContain("font-size: var(--ov-font-size, 14px);");
  });

  it("takes its colours only from locked colours: rejoin red and yellow, gain, dark text", () => {
    const colours = css.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
    expect(colours).toEqual([]);
    expect(rule(".rj--red")).toContain("var(--ov-locked-rejoin-red)");
    expect(rule(".rj--yellow")).toContain("var(--ov-locked-rejoin-yellow)");
    expect(rule(".rj--clear")).toContain("var(--ov-locked-gain)");
    expect(rule(".rj")).toContain("--rj-ink: var(--ov-locked-flag-black);");
  });

  it("sizes in em, apart from the 1 px divider and the corner radius", () => {
    expect(css.replace(/1px|6px;|14px\)/g, "")).not.toMatch(/\d+px/);
  });
});
