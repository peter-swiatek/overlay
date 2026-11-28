import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import type { LayoutView, LayoutsState, SimContext } from "../../../shared/layout-types";
import { LayoutsView, type LayoutActions } from "./LayoutsView";
import {
  addCar,
  contextLabels,
  countOn,
  groupOverlays,
  hasCar,
  overlaysForGame,
  toggleIn,
  type GroupOverlay,
} from "./model";

const noop = () => undefined;
const actions: LayoutActions = {
  activate: noop,
  create: noop,
  duplicate: noop,
  rename: noop,
  remove: noop,
  setMatch: noop,
  setAutoSwitch: noop,
  setEnabled: noop,
};
const OVERLAYS: GroupOverlay[] = [
  { id: "relative", title: "Relative", sims: ["iracing", "lmu"] },
  { id: "relative:2", title: "Relative 2", sims: ["iracing", "lmu"] },
  { id: "compact-hud", title: "Compact HUD", sims: ["iracing"] },
  { id: "car-status", title: "Car Status", sims: ["lmu"] },
];
const group = (patch: Partial<LayoutView> & { id: string }): LayoutView => ({
  name: patch.id,
  isDefault: false,
  match: { game: null, sessions: [], carTypes: [], cars: [] },
  enabled: {},
  ...patch,
});
const context = (c: Partial<SimContext> = {}): SimContext => ({
  sim: "iracing",
  carName: "Dallara F3",
  carType: "formula",
  sessionType: "race",
  testData: false,
  ...c,
});
const state = (patch: Partial<LayoutsState> = {}): LayoutsState => ({
  layouts: [
    group({
      id: "layout-1",
      name: "iRacing formula",
      match: { game: "iracing", sessions: ["race"], carTypes: ["formula"], cars: ["Dallara F3"] },
      enabled: { relative: true, "compact-hud": true, "car-status": true },
    }),
    group({
      id: "layout-2",
      name: "Le Mans Ultimate",
      match: { game: "lmu", sessions: [], carTypes: [], cars: [] },
      enabled: { "car-status": true },
    }),
    group({ id: "default", name: "Everything else", isDefault: true, enabled: { relative: true } }),
  ],
  activeId: "layout-1",
  autoSwitch: true,
  context: context(),
  ...patch,
});
const render = (s: LayoutsState) =>
  renderToStaticMarkup(<LayoutsView state={s} overlays={OVERLAYS} actions={actions} />);
/** The markup of one group's card. */
const card = (html: string, name: string): string => {
  const cards = html.split('<li class="ctl-section grp-card"').slice(1);
  return cards.find((c) => c.includes(`value="${name}"`) || c.includes(`>${name}</h3>`)) ?? "";
};

describe("overlay groups model", () => {
  it("lists every instance with its title in manifest order, developer overlays only with tools on", () => {
    const settings = {
      "data-frames:2": { name: "" },
      relative: { name: "" },
      "data-frames": { name: "Fuel tile" },
    } as unknown as Record<string, OverlayInstanceSettings>;
    const list = groupOverlays(OVERLAY_MANIFESTS, settings, false);
    const relativeAt = list.findIndex((o) => o.id === "relative");
    const framesAt = list.findIndex((o) => o.id === "data-frames");
    expect(list.find((o) => o.id === "data-frames")?.title).toBe("Fuel tile");
    expect(list[framesAt + 1]?.id).toBe("data-frames:2");
    expect(relativeAt).toBeGreaterThanOrEqual(0);
    const dev = OVERLAY_MANIFESTS.find((m) => m.dev === true);
    if (dev) {
      const withDev = { ...settings, [dev.id]: { name: "" } } as typeof settings;
      expect(groupOverlays(OVERLAY_MANIFESTS, withDev, false).some((o) => o.id === dev.id)).toBe(
        false,
      );
      expect(groupOverlays(OVERLAY_MANIFESTS, withDev, true).some((o) => o.id === dev.id)).toBe(
        true,
      );
    }
  });

  it("offers each overlay only in groups for its games", () => {
    expect(overlaysForGame(OVERLAYS, null)).toHaveLength(4);
    expect(overlaysForGame(OVERLAYS, "iracing").map((o) => o.id)).not.toContain("car-status");
    expect(overlaysForGame(OVERLAYS, "lmu").map((o) => o.id)).not.toContain("compact-hud");
    expect(countOn(overlaysForGame(OVERLAYS, "lmu"), { "compact-hud": true, relative: true })).toBe(
      1,
    );
  });

  it("words the current session, test data included", () => {
    expect(contextLabels(context())).toEqual({
      game: "iRacing",
      car: "Dallara F3",
      carType: "Formula",
      session: "Race",
    });
    const none = { sim: null, carName: null, carType: null, sessionType: null, testData: false };
    expect(contextLabels(none)).toEqual({
      game: "Not connected",
      car: "Unknown",
      carType: "Unknown",
      session: "Unknown",
    });
    expect(contextLabels({ ...none, testData: true, sessionType: "other" })).toMatchObject({
      game: "Test data",
      session: "Testing",
    });
    expect(contextLabels(context({ testData: true })).game).toBe("Test data (iRacing)");
    expect(contextLabels(context({ sim: "lmu", carType: null })).carType).toBe(
      "Not used in Le Mans Ultimate",
    );
  });

  it("toggles in canonical order and adds cars once", () => {
    expect(toggleIn(["race"], "practice", ["practice", "qualifying", "race"])).toEqual([
      "practice",
      "race",
    ]);
    expect(toggleIn(["race"], "race", ["practice", "race"])).toEqual([]);
    expect(addCar(["A"], " a ")).toEqual(["A"]);
    expect(addCar(["A"], " B ")).toEqual(["A", "B"]);
    expect(hasCar(["Porsche 963"], "porsche 963")).toBe(true);
  });
});

describe("LayoutsView", () => {
  it("explains groups in one line and shows the current session with its car type", () => {
    const html = render(state());
    expect(html).toContain("Groups switch automatically by game, session and car type.");
    expect(html).toContain("Current session");
    expect(html).toContain("Formula");
    expect(html).toMatch(/aria-label="Switch groups automatically" checked=""/);
    expect(render(state({ autoSwitch: false }))).not.toMatch(
      /aria-label="Switch groups automatically" checked=""/,
    );
  });

  it("shows each group as a card with everything visible, the fallback last", () => {
    const html = render(state());
    expect(html.indexOf("Everything else")).toBeGreaterThan(html.indexOf("Le Mans Ultimate"));
    expect(html.match(/class="grp-active"/g)).toHaveLength(1);
    expect(html.match(/>Not active</g)).toHaveLength(2);
    expect(html.match(/>Active when</g)).toHaveLength(2);
    expect(html.match(/>Overlays in this group/g)).toHaveLength(3);
    expect(html).toContain("New group");
    // Names are edited in place; the fallback's name is fixed and it cannot be deleted.
    expect(html.match(/aria-label="Group name"/g)).toHaveLength(2);
    expect(html.match(/>Delete</g)).toHaveLength(2);
    expect(card(html, "Everything else")).toContain("Used when no other group matches.");
  });

  it("marks the game, sessions and car types of a group", () => {
    const html = card(render(state()), "iRacing formula");
    expect(html).toMatch(/aria-pressed="true"[^>]*>iRacing</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Any</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Race</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Testing</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Formula</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Sports car</);
    expect(html).toContain("Specific cars (1)");
    expect(html).toContain('aria-label="Remove Dallara F3"');
    // The current car is already listed.
    expect(html).toMatch(/disabled="">Add current car</);
  });

  it("hides car types for a Le Mans Ultimate group", () => {
    const html = card(render(state()), "Le Mans Ultimate");
    expect(html).toContain(">Sessions<");
    expect(html).not.toContain(">Car type<");
    expect(html).not.toMatch(/disabled="">Add current car</);
  });

  it("lists only the overlays the group's game offers, with this group's on/off", () => {
    const html = render(state());
    const formula = card(html, "iRacing formula");
    expect(formula).toContain("Compact HUD");
    expect(formula).not.toContain("Car Status");
    expect(formula).toContain("2 of 3 on");
    const lmu = card(html, "Le Mans Ultimate");
    expect(lmu).toContain("Car Status");
    expect(lmu).not.toContain("Compact HUD");
    expect(lmu).toContain("1 of 3 on");
    const fallback = card(html, "Everything else");
    expect(fallback).toContain("Relative 2");
    expect(fallback).toContain("1 of 4 on");
  });

  it("disables Activate for the active group only", () => {
    const html = render(state());
    expect(html.match(/disabled="">Activate</g)).toHaveLength(1);
    expect(html.match(/>Activate</g)).toHaveLength(3);
  });
});
