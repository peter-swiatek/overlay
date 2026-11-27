import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import { EMPTY_SIM_CONTEXT, type SimContext } from "../shared/layout-types";
import type { Layout } from "./layout";
import { LayoutSwitcher } from "./layout-switcher";
import { LayoutsStore } from "./layouts-store";
import { OverlaySettingsStore } from "./overlay-settings-store";

const at = (x: number): Layout => ({
  relative: { x, y: 0, width: 400, height: 300, scalePct: 100 },
});
const ctx = (c: Partial<SimContext> = {}): SimContext => ({
  sim: "iracing",
  carName: "Dallara P217",
  carType: "sports",
  sessionType: "race",
  testData: false,
  ...c,
});

let dir: string;
let settings: OverlaySettingsStore;
let store: LayoutsStore;
let calls: string[];
let current: Layout;
let switcher: LayoutSwitcher;
const onState = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "overlay-switch-"));
  settings = new OverlaySettingsStore(join(dir, "s.json"), OVERLAY_MANIFESTS);
  settings.update("relative", { enabled: true });
  settings.update("inputs", { enabled: false });
  settings.update("fuel", { enabled: false });
  store = new LayoutsStore({
    file: join(dir, "layouts.json"),
    manifests: OVERLAY_MANIFESTS,
    loadLegacyBounds: () => at(10),
    currentSettings: () => settings.getAll(),
  });
  calls = [];
  current = store.active().bounds;
  onState.mockReset();
  switcher = new LayoutSwitcher({
    store,
    settings,
    overlays: {
      flushSave: () => {
        calls.push("flush");
        // The manager saves its (live) bounds into the layout that is still active.
        store.saveActiveBounds(current);
      },
      replaceLayout: (bounds) => {
        calls.push("replace");
        current = structuredClone(bounds);
      },
    },
    onStateChange: onState,
  });
  switcher.start();
});
afterEach(() => {
  settings.flush();
  rmSync(dir, { recursive: true, force: true });
});

/** A second layout with Inputs on and Relative off, placed at x = 900. */
function makeRaceLayout(): string {
  const id = store.duplicate("default") ?? "";
  const layout = store.get(id);
  if (!layout) throw new Error("no layout");
  layout.enabled = { ...layout.enabled, relative: false, inputs: true };
  layout.bounds = at(900);
  store.setMatch(id, { sessions: ["race"] });
  return id;
}

describe("LayoutSwitcher", () => {
  it("flushes the old bounds, then moves windows and turns overlays on and off", () => {
    const id = makeRaceLayout();
    current = at(55);
    expect(switcher.activate(id)).toBe(true);
    expect(calls).toEqual(["flush", "replace"]);
    expect(store.get("default")?.bounds).toEqual(at(55));
    expect(current).toEqual(at(900));
    expect(settings.get("relative")?.enabled).toBe(false);
    expect(settings.get("inputs")?.enabled).toBe(true);
    // The layout switched to keeps its own states.
    expect(store.get(id)?.enabled["inputs"]).toBe(true);
    expect(store.get("default")?.enabled["inputs"]).toBe(false);
    expect(switcher.state().activeId).toBe(id);
  });

  it("does nothing for the active or an unknown layout", () => {
    expect(switcher.activate("default")).toBe(true);
    expect(switcher.activate("nope")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("saves turning an overlay on or off into the active layout only", () => {
    const id = makeRaceLayout();
    switcher.activate(id);
    settings.update("fuel", { enabled: true });
    expect(store.get(id)?.enabled["fuel"]).toBe(true);
    expect(store.get("default")?.enabled["fuel"]).toBe(false);
  });

  it("forgets a removed instance in every layout", () => {
    const added = settings.addInstance("data-frames") ?? "";
    expect(added).not.toBe("");
    expect(store.active().enabled[added]).toBe(true);
    settings.removeInstance(added);
    expect(added in store.active().enabled).toBe(false);
  });

  it("switches automatically to the best match when the context changes", () => {
    const id = makeRaceLayout();
    switcher.setContext(ctx());
    expect(switcher.state().activeId).toBe(id);
    expect(switcher.state().context).toEqual(ctx());
    // The iRacing starter group beats the fallback.
    switcher.setContext(ctx({ sessionType: "practice" }));
    expect(switcher.state().activeId).toBe("layout-1");
    switcher.setContext(ctx({ sim: "lmu", carType: null, sessionType: "practice" }));
    expect(switcher.state().activeId).toBe("layout-2");
    switcher.setContext(ctx({ sim: null, sessionType: "practice", testData: true }));
    expect(switcher.state().activeId).toBe("default");
  });

  it("keeps a layout picked by hand until the context changes", () => {
    const id = makeRaceLayout();
    switcher.setContext(ctx());
    switcher.activate("default");
    switcher.setContext(ctx());
    expect(switcher.state().activeId).toBe("default");
    // Leaving the sim and coming back to the same session changes nothing either.
    switcher.setContext(EMPTY_SIM_CONTEXT);
    switcher.setContext(ctx());
    expect(switcher.state().activeId).toBe("default");
    switcher.setContext(ctx({ sessionType: "qualifying" }));
    switcher.setContext(ctx());
    expect(switcher.state().activeId).toBe(id);
  });

  it("does not switch while automatic switching is off, and applies the match when it is turned on", () => {
    const id = makeRaceLayout();
    switcher.setAutoSwitch(false);
    switcher.setContext(ctx());
    expect(switcher.state().activeId).toBe("default");
    switcher.setAutoSwitch(true);
    expect(switcher.state().activeId).toBe(id);
  });

  it("deletes the active layout by switching to Default first", () => {
    const id = makeRaceLayout();
    switcher.activate(id);
    expect(switcher.remove(id)).toBe(true);
    expect(switcher.state().activeId).toBe("default");
    expect(settings.get("relative")?.enabled).toBe(true);
    expect(switcher.remove("default")).toBe(false);
  });

  it("makes a new layout from the active one and activates it", () => {
    const id = switcher.create() ?? "";
    expect(switcher.state().activeId).toBe(id);
    expect(store.get(id)?.enabled).toEqual(store.get("default")?.enabled);
  });

  it("turns an overlay on or off in the active group at once, and only in the data otherwise", () => {
    settings.update("weather", { enabled: false });
    expect(switcher.setEnabled("layout-1", "weather", true)).toBe(true);
    expect(store.get("layout-1")?.enabled["weather"]).toBe(true);
    expect(settings.get("weather")?.enabled).toBe(false);
    expect(switcher.setEnabled("default", "weather", true)).toBe(true);
    expect(settings.get("weather")?.enabled).toBe(true);
    expect(store.get("default")?.enabled["weather"]).toBe(true);
    expect(switcher.setEnabled("nope", "weather", true)).toBe(false);
  });

  it("opens only what the group's game offers", () => {
    settings.update("compact-hud", { enabled: true });
    switcher.setEnabled("layout-2", "compact-hud", true);
    switcher.activate("layout-2");
    expect(settings.get("compact-hud")?.enabled).toBe(false);
    // Changing the active group's game closes and opens windows to fit.
    switcher.setMatch("layout-2", { game: null });
    expect(settings.get("compact-hud")?.enabled).toBe(true);
  });

  it("reports state changes", () => {
    switcher.setContext(ctx());
    expect(onState).toHaveBeenCalled();
    const last = onState.mock.calls.at(-1)?.[0] as ReturnType<LayoutSwitcher["state"]>;
    expect(last.context).toEqual(ctx());
    expect(last.layouts.at(-1)?.isDefault).toBe(true);
  });
});
