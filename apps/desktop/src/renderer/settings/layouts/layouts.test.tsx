import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LayoutView, LayoutsState } from "../../../shared/layout-types";
import { LayoutsView, type LayoutActions } from "./LayoutsView";
import {
  addCar,
  contextLabels,
  hasCar,
  overlayCountLabel,
  tagsSummary,
  toggleSession,
  toggleSim,
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
};
const view = (patch: Partial<LayoutView> & { id: string }): LayoutView => ({
  name: patch.id,
  isDefault: false,
  match: { sims: [], cars: [], sessions: [] },
  overlayCount: 0,
  ...patch,
});
const state = (patch: Partial<LayoutsState> = {}): LayoutsState => ({
  layouts: [
    view({ id: "default", name: "Default", isDefault: true, overlayCount: 4 }),
    view({
      id: "layout-1",
      name: "Endurance",
      overlayCount: 1,
      match: {
        sims: ["iracing"],
        sessions: ["qualifying", "race"],
        cars: ["Porsche 963", "BMW M Hybrid V8"],
      },
    }),
  ],
  activeId: "layout-1",
  autoSwitch: true,
  context: { sim: "iracing", carName: "Porsche 963", sessionType: "other" },
  ...patch,
});
const render = (s: LayoutsState, editingId?: string) =>
  renderToStaticMarkup(<LayoutsView state={s} actions={actions} editingId={editingId} />);

describe("layouts model", () => {
  it("summarises the tags", () => {
    expect(tagsSummary(view({ id: "x", isDefault: true }))).toBe(
      "Used when no other layout matches",
    );
    expect(tagsSummary(view({ id: "x" }))).toBe("No tags: any sim, session and car");
    expect(
      tagsSummary(
        view({
          id: "x",
          match: { sims: ["iracing"], sessions: ["qualifying", "race"], cars: ["A", "B"] },
        }),
      ),
    ).toBe("iRacing · Qualifying, Race · 2 cars");
    expect(
      tagsSummary(
        view({ id: "x", match: { sims: ["lmu"], sessions: ["other"], cars: ["Oreca 07"] } }),
      ),
    ).toBe("Le Mans Ultimate · Testing / other · Oreca 07");
  });

  it("words the overlay count and the context", () => {
    expect(overlayCountLabel(0)).toBe("No overlays");
    expect(overlayCountLabel(1)).toBe("1 overlay");
    expect(overlayCountLabel(5)).toBe("5 overlays");
    expect(contextLabels({ sim: null, carName: null, sessionType: null })).toEqual({
      sim: "Not connected",
      car: "Unknown",
      session: "Unknown",
    });
    expect(contextLabels({ sim: "lmu", carName: "Oreca 07", sessionType: "other" })).toEqual({
      sim: "Le Mans Ultimate",
      car: "Oreca 07",
      session: "Testing / other",
    });
  });

  it("toggles tags in canonical order and adds cars once", () => {
    const match = { sims: [], cars: [], sessions: ["race" as const] };
    expect(toggleSession(match, "practice")).toEqual(["practice", "race"]);
    expect(toggleSession(match, "race")).toEqual([]);
    expect(toggleSim({ ...match, sims: ["lmu"] }, "iracing")).toEqual(["iracing", "lmu"]);
    expect(addCar(["A"], " a ")).toEqual(["A"]);
    expect(addCar(["A"], "  ")).toEqual(["A"]);
    expect(addCar(["A"], " B ")).toEqual(["A", "B"]);
    expect(hasCar(["Porsche 963"], "porsche 963")).toBe(true);
  });
});

describe("LayoutsView", () => {
  it("shows the current context and the automatic switch", () => {
    const html = render(state());
    expect(html).toContain("Current session");
    expect(html).toContain("iRacing");
    expect(html).toContain("Porsche 963");
    expect(html).toContain("Testing / other");
    expect(html).toMatch(/aria-label="Switch layouts automatically" checked=""/);
    expect(render(state({ autoSwitch: false }))).not.toMatch(
      /aria-label="Switch layouts automatically" checked=""/,
    );
  });

  it("lists each layout with its badge, summary, count and actions", () => {
    const html = render(state());
    expect(html).toContain("Default");
    expect(html).toContain("Endurance");
    expect(html.match(/class="lay-active"/g)).toHaveLength(1);
    expect(html).toContain("iRacing · Qualifying, Race · 2 cars");
    expect(html).toContain("4 overlays");
    expect(html).toContain("1 overlay");
    expect(html).toContain("New layout");
    // Default cannot be renamed, tagged or deleted.
    expect(html.match(/>Rename</g)).toHaveLength(1);
    expect(html.match(/>Delete</g)).toHaveLength(1);
    expect(html.match(/>Edit tags</g)).toHaveLength(1);
    expect(html.match(/>Duplicate</g)).toHaveLength(2);
  });

  it("disables Activate for the active layout only", () => {
    const html = render(state());
    expect(html.match(/disabled="">Activate</g)).toHaveLength(1);
    expect(html.match(/>Activate</g)).toHaveLength(2);
  });

  it("edits tags inline with sim and session boxes and the car list", () => {
    const html = render(state(), "layout-1");
    expect(html).toContain("Done");
    for (const label of ["Le Mans Ultimate", "Practice", "Qualifying", "Race", "Warmup"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('aria-label="Remove Porsche 963"');
    expect(html).toContain('aria-label="Remove BMW M Hybrid V8"');
    // The current car is already listed, so it cannot be added again.
    expect(html).toMatch(/disabled="">Add current car</);
    expect(html.match(/type="checkbox" checked=""/g)).toHaveLength(3);
  });

  it("offers Add current car only when a car is known and not listed", () => {
    const other = state({
      context: { sim: "iracing", carName: "Cadillac V-Series.R", sessionType: "race" },
    });
    expect(render(other, "layout-1")).not.toMatch(/disabled="">Add current car</);
    const none = state({ context: { sim: null, carName: null, sessionType: null } });
    expect(render(none, "layout-1")).toMatch(/disabled="">Add current car</);
    expect(render(none)).toContain("Not connected");
  });
});
