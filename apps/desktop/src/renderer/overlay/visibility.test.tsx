import { emptyCar, emptySimState, type TelemetryFrame } from "@overlay/sim-core";
import { moduleById, type OverlayModule } from "@overlay/overlays";
import { defaultInstanceSettings } from "@overlay/overlays/settings";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlayErrorBoundary } from "./ErrorBoundary";
import { OverlayContent } from "./OverlayContent";
import { contentStyle } from "./OverlayFrame";
import {
  cappedRateHz,
  hostView,
  overlayVisibility,
  unsupportedNote,
  type HostView,
  type VisibilityInput,
} from "./visibility";

const demoInputsModule = moduleById("demo-inputs") as OverlayModule;
const rules = { hideInGarage: false, hideOnTrack: false, alwaysShow: false };
const base: VisibilityInput = {
  live: true,
  playerOnTrack: true,
  sim: "iracing",
  manifestSims: ["iracing", "lmu"],
  common: rules,
  autoHide: false,
  editing: false,
};
const visibility = (patch: Partial<VisibilityInput>) => overlayVisibility({ ...base, ...patch });

describe("overlayVisibility", () => {
  it("shows a live overlay", () => {
    expect(visibility({})).toBe("show");
  });

  it("shows the notice without data", () => {
    expect(visibility({ live: false })).toBe("notice");
  });

  it("hides without data when auto-hide is on, unless always show is set", () => {
    expect(visibility({ live: false, autoHide: true })).toBe("hidden");
    expect(
      visibility({ live: false, autoHide: true, common: { ...rules, alwaysShow: true } }),
    ).toBe("notice");
  });

  it("keeps the notice in edit mode even with auto-hide", () => {
    expect(visibility({ live: false, autoHide: true, editing: true })).toBe("notice");
  });

  it("does not apply auto-hide while data is live", () => {
    expect(visibility({ autoHide: true })).toBe("show");
  });

  it("renders nothing for an unsupported sim, also in edit mode (the host adds a note)", () => {
    expect(visibility({ sim: "lmu", manifestSims: ["iracing"] })).toBe("unsupported");
    expect(visibility({ sim: "lmu", manifestSims: ["iracing"], editing: true })).toBe(
      "unsupported",
    );
  });

  it("treats an unknown sim (mock) as supported", () => {
    expect(visibility({ sim: null, manifestSims: ["iracing"] })).toBe("show");
  });

  it("hides in the garage only when the player is known to be off track", () => {
    const common = { ...rules, hideInGarage: true };
    expect(visibility({ common, playerOnTrack: false })).toBe("hidden");
    expect(visibility({ common, playerOnTrack: true })).toBe("show");
    expect(visibility({ common, playerOnTrack: null })).toBe("show");
  });

  it("hides on track only when the player is on track", () => {
    const common = { ...rules, hideOnTrack: true };
    expect(visibility({ common, playerOnTrack: true })).toBe("hidden");
    expect(visibility({ common, playerOnTrack: false })).toBe("show");
    expect(visibility({ common, playerOnTrack: null })).toBe("show");
  });

  it("shows hidden overlays in edit mode", () => {
    const common = { ...rules, hideInGarage: true, hideOnTrack: true };
    expect(visibility({ common, playerOnTrack: false, editing: true })).toBe("show");
    expect(visibility({ common, playerOnTrack: true, editing: true })).toBe("show");
  });
});

describe("cappedRateHz", () => {
  it("takes the lowest of request, manifest and performance cap", () => {
    expect(cappedRateHz(60, 10, 30)).toBe(10);
    expect(cappedRateHz(60, 60, 30)).toBe(30);
    expect(cappedRateHz(5, 60, 60)).toBe(5);
  });
  it("never goes below 1 Hz or returns a non-finite rate", () => {
    expect(cappedRateHz(0, 10, 30)).toBe(1);
    expect(cappedRateHz(Number.NaN, 10, 30)).toBe(1);
  });
});

function frame(status: TelemetryFrame["status"], onTrack: boolean | null): TelemetryFrame {
  const state = emptySimState("mock");
  state.sim = "lmu";
  state.playerCarIdx = 2;
  state.cars = [{ ...emptyCar(2), isOnTrack: onTrack }];
  return {
    seq: 1,
    source: "mock",
    status,
    error: status === "error" ? "Reader failed" : null,
    state,
    derived: {
      fuel: null,
      energy: null,
      track: { trackKey: null, outlineReady: false },
      standings: null,
      proximity: null,
      gaps: [],
    },
  };
}

describe("hostView", () => {
  it("reads the player's on-track flag and sim from a live frame", () => {
    expect(hostView(frame("live", false), false)).toEqual({
      live: true,
      playerOnTrack: false,
      sim: "lmu",
      notice: null,
    });
  });
  it("treats an LMU car in its garage stall as in the garage", () => {
    const f = frame("live", true);
    f.state.cars[0] = { ...f.state.cars[0]!, onPitRoad: true, inPitStall: true };
    expect(hostView(f, false).playerOnTrack).toBe(false);
    f.state.cars[0] = { ...f.state.cars[0]!, inPitStall: false };
    expect(hostView(f, false).playerOnTrack).toBe(true);
  });
  it("carries the notice when there is no live data", () => {
    expect(hostView(null, false)).toMatchObject({ live: false, notice: "Waiting for sim" });
    expect(hostView(frame("error", null), false)).toMatchObject({ notice: "Reader failed" });
    expect(hostView(frame("live", true), true)).toMatchObject({ live: false, notice: "No data" });
  });
});

describe("unsupportedNote", () => {
  it("names the sim", () => {
    expect(unsupportedNote("lmu")).toBe("Not available in LMU");
    expect(unsupportedNote("iracing")).toBe("Not available in iRacing");
  });
});

describe("contentStyle", () => {
  const common = { opacityPct: 80, scalePct: 150, rowOpacityPct: 40 };
  it("sets opacity and zoom, and row opacity only for tables", () => {
    expect(contentStyle(common, false)).toEqual({ opacity: 0.8, zoom: 1.5 });
    expect(contentStyle(common, true)).toEqual({
      opacity: 0.8,
      zoom: 1.5,
      "--ov-row-opacity": 0.4,
    });
  });
});

describe("OverlayContent", () => {
  const live: HostView = { live: true, playerOnTrack: true, sim: "iracing", notice: null };
  const settings = defaultInstanceSettings(demoInputsModule.manifest);
  const render = (view: HostView, editing = false, module: OverlayModule = demoInputsModule) =>
    renderToStaticMarkup(
      <OverlayContent
        module={module}
        settings={settings}
        autoHide={false}
        view={view}
        editing={editing}
      />,
    );

  it("shows the notice instead of the overlay without data", () => {
    const html = render({ live: false, playerOnTrack: null, sim: null, notice: "Waiting for sim" });
    expect(html).toContain("Waiting for sim");
    expect(html).not.toContain("inputs");
  });

  it("adds the edit frame with the overlay title in edit mode", () => {
    const html = render(live, true, { ...demoInputsModule, Component: () => <i>body</i> });
    expect(html).toContain("edit-frame");
    expect(html).toContain("Inputs (demo)");
    expect(html).toContain("opacity:1");
  });

  it("shows a note for an unsupported sim only in edit mode", () => {
    const onlyIracing: OverlayModule = {
      ...demoInputsModule,
      manifest: { ...demoInputsModule.manifest, sims: ["iracing"] },
    };
    const lmu: HostView = { ...live, sim: "lmu" };
    expect(render(lmu, false, onlyIracing)).toBe("");
    expect(render(lmu, true, onlyIracing)).toContain("Not available in LMU");
  });

  it("recovers into the error panel state when the overlay throws", () => {
    // Server rendering rethrows, so only the boundary's state transition is checked here.
    expect(OverlayErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });
});
