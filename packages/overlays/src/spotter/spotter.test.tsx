// Tests may use the sim-core entry for fixtures; overlay code itself must not.
import { emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultInstanceSettings } from "../settings";
import { OverlayRuntimeContext, staticRuntime } from "../runtime";
import { spotterManifest } from "./manifest";
import { SpotterOverlay } from "./SpotterOverlay";
import { barColourCss, newSpotterMemory, offsetToPosition, spotterView } from "./view";

type Prox = NonNullable<TelemetryFrame["derived"]["proximity"]>;

function frame(prox: Partial<Prox> | null, status: TelemetryFrame["status"] = "live") {
  const f: TelemetryFrame = {
    seq: 1,
    source: "mock",
    status,
    error: null,
    state: emptySimState("mock"),
    derived: {
      fuel: null,
      energy: null,
      track: { trackKey: null, outlineReady: false },
      standings: null,
      proximity:
        prox === null
          ? null
          : {
              carLeftRight: "clear",
              left: null,
              right: null,
              nearby: [],
              carLengthM: 4.8,
              ...prox,
            },
      gaps: [],
    },
  };
  return f;
}

describe("offsetToPosition", () => {
  it("maps -1, 0 and +1 to bottom, middle and top", () => {
    expect(offsetToPosition(-1)).toBe(1);
    expect(offsetToPosition(0)).toBe(0.5);
    expect(offsetToPosition(1)).toBe(0);
  });
  it("clamps beyond +-1 and rounds to 0.01", () => {
    expect(offsetToPosition(3)).toBe(0);
    expect(offsetToPosition(-3)).toBe(1);
    expect(offsetToPosition(0.3333)).toBe(0.33);
  });
});

describe("spotterView", () => {
  it("shows left only, right only and both", () => {
    expect(spotterView(frame({ left: 0 }), newSpotterMemory(), 0)).toEqual({
      left: { position: 0.5, double: false },
      right: { position: null, double: false },
    });
    const r = spotterView(frame({ right: -1 }), newSpotterMemory(), 0);
    expect(r.right.position).toBe(1);
    expect(r.left.position).toBeNull();
    const both = spotterView(
      frame({ left: 1, right: 0, carLeftRight: "both" }),
      newSpotterMemory(),
      0,
    );
    expect(both.left.position).toBe(0);
    expect(both.right.position).toBe(0.5);
  });

  it("marks two cars on a side as double", () => {
    const l = spotterView(frame({ left: 0, carLeftRight: "twoLeft" }), newSpotterMemory(), 0);
    expect(l.left.double).toBe(true);
    expect(l.right.double).toBe(false);
    const r = spotterView(frame({ right: 0, carLeftRight: "twoRight" }), newSpotterMemory(), 0);
    expect(r.right.double).toBe(true);
  });

  it("holds a cleared side for 300 ms, then hides it", () => {
    const mem = newSpotterMemory();
    spotterView(frame({ left: 0.4 }), mem, 1000);
    const clear = frame({});
    expect(spotterView(clear, mem, 1000).left.position).toBe(0.3);
    expect(spotterView(clear, mem, 1299).left.position).toBe(0.3);
    expect(spotterView(clear, mem, 1301).left.position).toBeNull();
  });

  it("shows a new car at once and restarts the hold", () => {
    const mem = newSpotterMemory();
    expect(spotterView(frame({ right: 0 }), mem, 0).right.position).toBe(0.5);
    spotterView(frame({}), mem, 1000);
    expect(spotterView(frame({ right: 1 }), mem, 1001).right.position).toBe(0);
    expect(spotterView(frame({}), mem, 1200).right.position).toBe(0);
  });

  it("hides (after the hold) when not live or proximity is null", () => {
    for (const f of [frame(null), frame({ left: 0 }, "waiting"), null]) {
      const mem = newSpotterMemory();
      spotterView(frame({ left: 0 }), mem, 0);
      expect(spotterView(f, mem, 100).left.position).toBe(0.5);
      expect(spotterView(f, mem, 301).left.position).toBeNull();
    }
  });
});

describe("barColourCss", () => {
  it("resolves accent, hex and junk", () => {
    expect(barColourCss("accent")).toBe("var(--ov-accent)");
    expect(barColourCss("#ff8800")).toBe("#ff8800");
    expect(barColourCss("orange; evil")).toBe("var(--ov-accent)");
  });
});

function render(f: TelemetryFrame | null, editing = false, options: Record<string, number> = {}) {
  const settings = defaultInstanceSettings(spotterManifest);
  Object.assign(settings.options, options);
  return renderToStaticMarkup(
    <OverlayRuntimeContext.Provider value={staticRuntime(f, { editing })}>
      <SpotterOverlay settings={settings} />
    </OverlayRuntimeContext.Provider>,
  );
}

const count = (html: string, s: string) => html.split(s).length - 1;

describe("SpotterOverlay", () => {
  it("renders one block on the left with the expected translateY", () => {
    const html = render(frame({ left: 0 }));
    expect(count(html, "spotter-block")).toBe(1);
    // block 70 px on a 140 px bar, position 0.5 → 35 px
    expect(html).toContain("translateY(35px)");
    expect(html.indexOf("spotter-block")).toBeLessThan(html.indexOf("spotter-gap"));
  });

  it("applies option values to the inline sizes", () => {
    const html = render(frame({ right: -1 }), false, {
      "bar-gap": 300,
      "bar-length": 200,
      "bar-width": 20,
    });
    expect(html).toContain("width:20px;height:200px");
    expect(html).toContain("width:280px");
    expect(html).toContain("translateY(100px)");
  });

  it("shows nothing but empty bars when clear, and the sample in edit mode", () => {
    expect(count(render(frame({})), "spotter-block")).toBe(0);
    expect(count(render(frame({})), "spotter-bar--track")).toBe(0);
    const edit = render(null, true);
    expect(count(edit, "spotter-block")).toBe(2);
    expect(count(edit, "spotter-bar--track")).toBe(2);
  });

  it("scopes transitions to full-effects mode", () => {
    const css = readFileSync(new URL("./spotter.css", import.meta.url), "utf8");
    expect(css).toContain(':root:not([data-reduced-effects="true"])');
    const t = css.indexOf("transition:");
    expect(css.lastIndexOf(":root:not", t)).toBeGreaterThan(css.lastIndexOf("}", t));
  });
});
