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
  sessionType: "race",
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
    switcher.setContext(ctx({ sessionType: "practice" }));
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

  it("reports state changes", () => {
    switcher.setContext(ctx());
    expect(onState).toHaveBeenCalled();
    const last = onState.mock.calls.at(-1)?.[0] as ReturnType<LayoutSwitcher["state"]>;
    expect(last.context).toEqual(ctx());
    expect(last.layouts[0]?.isDefault).toBe(true);
  });
});
