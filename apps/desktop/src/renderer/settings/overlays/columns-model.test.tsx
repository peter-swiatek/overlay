import type { OverlayManifest, OverlaySettingsPatch } from "@overlay/overlays/contract";
import { columnFloorChars } from "@overlay/overlays/fields";
import { OVERLAY_MANIFESTS } from "@overlay/overlays/manifests";
import { applySettingsPatch, defaultInstanceSettings } from "@overlay/overlays/settings";
import { columnFloorPct } from "@overlay/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColumnEditor } from "./ColumnEditor";
import {
  customWidthPatch,
  floorPctFor,
  planWidthChange,
  resizeNote,
  sliderValue,
  totalMessage,
  widthHiddenLabels,
  widthTotal,
} from "./columns-model";
import { moveField } from "./model";
import { createDebouncer, type TimerApi } from "./debounce";
import { createOverlaySender, type AllSettings } from "./sender";

const leaderboard: OverlayManifest = (() => {
  const found = OVERLAY_MANIFESTS.find((m) => m.id === "leaderboard");
  if (!found) throw new Error("leaderboard manifest missing");
  return found;
})();
const base = defaultInstanceSettings(leaderboard);
const noop = () => undefined;

function html(extra: Partial<Parameters<typeof ColumnEditor>[0]> = {}): string {
  return renderToStaticMarkup(
    <ColumnEditor
      manifest={leaderboard}
      fields={base.common.fields}
      sim="iracing"
      onFields={noop}
      onWidth={noop}
      {...extra}
    />,
  );
}

describe("floorPctFor", () => {
  it("uses the shared floor chars and the measured table", () => {
    const chars = columnFloorChars("last-lap");
    expect(chars).toBe(8);
    expect(floorPctFor(leaderboard, "last-lap", { tableWidthPx: 500, chPx: 8 })).toBe(
      columnFloorPct(8, 500, 8, 8, 100),
    );
  });

  it("falls back to the window width and 7 px per ch before the first measurement", () => {
    const width = leaderboard.defaultSize.width;
    expect(floorPctFor(leaderboard, "driver")).toBe(columnFloorPct(10, width, 7, 8, 100));
  });

  it("is in the stored unit: stored width times Fine-tune draws at the floor, one less does not", () => {
    for (const fine of [50, 75, 100, 150]) {
      for (const id of ["gap", "last-lap", "driver"]) {
        const inputs = { tableWidthPx: 600, chPx: 7, widthScalePct: fine };
        const stored = floorPctFor(leaderboard, id, inputs);
        const drawnFloor = columnFloorPct(columnFloorChars(id)!, 600, 7, 8, fine);
        expect(stored * (fine / 100)).toBeGreaterThanOrEqual(drawnFloor - 1e-9);
        if (stored > 1) expect((stored - 1) * (fine / 100)).toBeLessThan(drawnFloor);
      }
    }
    // 150 %: the drawn floor is 10 % of the table, so a stored 7 % (drawn 10.5 %) is reachable.
    const pos = floorPctFor(leaderboard, "position", {
      tableWidthPx: 600,
      chPx: 7,
      widthScalePct: 150,
    });
    expect(pos).toBeLessThan(10);
  });

  it("is 1 for unknown columns", () => {
    expect(floorPctFor(leaderboard, "nope")).toBe(1);
  });
});

describe("slider minimum", () => {
  it("equals the column floor, and the shown value never sits below it", () => {
    const inputs = { tableWidthPx: 400, chPx: 7 };
    const out = html(inputs);
    for (const id of ["gap", "driver", "last-lap"]) {
      const floor = floorPctFor(leaderboard, id, inputs);
      const label = leaderboard.fields.find((f) => f.id === id)!.label;
      const tag = new RegExp(`<input[^>]*aria-label="Width of ${label}"[^>]*>`).exec(out)?.[0];
      expect(tag).toBeDefined();
      expect(tag).toContain(`min="${floor}"`);
    }
    const config = { id: "gap", visible: true, widthPct: 2 };
    expect(sliderValue(config, leaderboard, 15)).toBe(15);
    expect(sliderValue({ ...config, widthPct: 30 }, leaderboard, 15)).toBe(30);
  });

  it("marks the floor", () => {
    expect(html({ tableWidthPx: 400, chPx: 7 })).toContain("Narrowest readable width");
  });
});

describe("total readout", () => {
  const withWidths = (widths: Record<string, number>) =>
    base.common.fields.map((f) => ({
      ...f,
      visible: f.id in widths,
      widthPct: widths[f.id] ?? f.widthPct,
    }));

  it("says the Driver column takes the rest when under 100", () => {
    const total = widthTotal(leaderboard, withWidths({ position: 6, driver: 30, gap: 9 }));
    expect(total.totalPct).toBe(45);
    expect(totalMessage(total)).toBe("Total 45 %. The Driver name column takes the rest.");
  });

  it("warns when the columns are wider than the table", () => {
    const total = widthTotal(leaderboard, withWidths({ position: 40, driver: 40, gap: 40 }));
    expect(total.over).toBe(true);
    expect(totalMessage(total)).toBe(
      "Columns are wider than the table; the overlay will widen to fit.",
    );
  });

  it("counts the Fine-tune scale and renders the message", () => {
    const fields = withWidths({ position: 45, driver: 45 });
    expect(widthTotal(leaderboard, fields, 125).over).toBe(true);
    expect(html({ widthMode: "custom", fields: withWidths({ position: 6, driver: 30 }) })).toMatch(
      /Total \d+ %\./,
    );
  });
});

describe("auto-Custom", () => {
  it("plans a mode switch only from Auto or Compact", () => {
    const f = base.common.fields;
    expect(planWidthChange(f, "gap", 20, "auto").setCustom).toBe(true);
    expect(planWidthChange(f, "gap", 20, "compact").setCustom).toBe(true);
    expect(planWidthChange(f, "gap", 20, "custom").setCustom).toBe(false);
    expect(planWidthChange(f, "gap", 20, undefined).setCustom).toBe(false);
    expect(planWidthChange(f, "gap", 20, "auto").fields.find((x) => x.id === "gap")!.widthPct).toBe(
      20,
    );
  });

  it("one patch carries both fields and column-width custom", () => {
    const plan = planWidthChange(base.common.fields, "gap", 20, "auto");
    const patch = customWidthPatch(plan.fields);
    expect(patch.common?.fields).toBe(plan.fields);
    expect(patch.options).toEqual({ "column-width": "custom" });
    const next = applySettingsPatch(leaderboard, base, patch);
    expect(next.options["column-width"]).toBe("custom");
    expect(next.common.fields.find((x) => x.id === "gap")!.widthPct).toBe(20);
  });

  it("shows the switched note and the legacy note only where they apply", () => {
    expect(html()).toContain("Widths apply when Column width is Custom.");
    expect(html({ widthMode: "auto" })).not.toContain("Widths apply");
    expect(html({ widthMode: "auto" })).not.toContain("set to Custom");
  });
});

describe("reorder then width", () => {
  it("a width change straight after a drag reorder keeps the new order", () => {
    const timers = new Map<number, () => void>();
    let n = 0;
    const timer: TimerApi<number> = {
      set: (fn) => {
        timers.set(++n, fn);
        return n;
      },
      clear: (h) => void timers.delete(h),
    };
    const sent: unknown[] = [];
    let shown: AllSettings = {};
    const sender = createOverlaySender({
      manifests: [leaderboard],
      debouncer: createDebouncer(timer),
      update: async (_id, patch) => void sent.push(patch),
      publish: (next) => (shown = next),
    });
    sender.load({ [leaderboard.id]: base });
    const fieldsNow = () => shown[leaderboard.id]!.common.fields;

    sender.send(leaderboard.id, { common: { fields: moveField(fieldsNow(), 0, 3) } });
    const plan = planWidthChange(fieldsNow(), "gap", 22, "auto");
    sender.send(leaderboard.id, customWidthPatch(plan.fields), "fields-width");
    [...timers.values()].forEach((f) => f());

    const order = moveField(base.common.fields, 0, 3).map((f) => f.id);
    expect(fieldsNow().map((f) => f.id)).toEqual(order);
    expect(shown[leaderboard.id]!.options["column-width"]).toBe("custom");
    expect(fieldsNow().find((f) => f.id === "gap")!.widthPct).toBe(22);
  });
});

describe("multi-tick width drag from Auto", () => {
  it("still sends column-width custom to main and keeps the last width", () => {
    const timers = new Map<number, () => void>();
    let n = 0;
    const timer: TimerApi<number> = {
      set: (fn) => {
        timers.set(++n, fn);
        return n;
      },
      clear: (h) => void timers.delete(h),
    };
    const sent: OverlaySettingsPatch[] = [];
    let shown: AllSettings = {};
    const sender = createOverlaySender({
      manifests: [leaderboard],
      debouncer: createDebouncer(timer),
      update: async (_id, patch) => void sent.push(patch),
      publish: (next) => (shown = next),
    });
    const id = leaderboard.id;
    sender.load({ [id]: base });
    // What ColumnEditor.changeWidth does for each slider tick.
    for (const pct of [12, 15, 19, 22]) {
      const mode = shown[id]!.options["column-width"] === "custom" ? "custom" : "auto";
      const plan = planWidthChange(shown[id]!.common.fields, "gap", pct, mode);
      sender.send(
        id,
        plan.setCustom ? customWidthPatch(plan.fields) : { common: { fields: plan.fields } },
        "fields-width",
      );
    }
    [...timers.values()].forEach((f) => f());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.options).toEqual({ "column-width": "custom" });
    expect(sent[0]!.common!.fields!.find((f) => f.id === "gap")!.widthPct).toBe(22);
    // The echo of what main stored keeps the page on Custom.
    sender.incoming(id, applySettingsPatch(leaderboard, base, sent[0]!));
    expect(shown[id]!.options["column-width"]).toBe("custom");
  });
});

describe("keyboard moves", () => {
  it("renders Move up and Move down for every column, disabled at the ends", () => {
    const out = html();
    expect(out).toMatch(/aria-label="Move up Position"[^>]*disabled/);
    expect(out).not.toMatch(/aria-label="Move down Position"[^>]*disabled/);
    expect(out).toContain('aria-label="Default width of Driver name"');
    const last = base.common.fields.at(-1)!;
    const lastLabel = leaderboard.fields.find((f) => f.id === last.id)!.label;
    expect(out).toContain(`aria-label="Move down ${lastLabel}" disabled=""`);
  });
});

describe("widthHiddenLabels", () => {
  it("lists visible hidden fields by manifest label in config order", () => {
    const fields = base.common.fields.map((f) =>
      f.id === "irating" || f.id === "last-lap" ? { ...f, visible: true } : f,
    );
    const labels = widthHiddenLabels(leaderboard, fields, ["last-lap", "irating"]);
    expect(labels).toHaveLength(2);
    expect(labels).toEqual(
      fields
        .filter((f) => f.id === "irating" || f.id === "last-lap")
        .map((f) => leaderboard.fields.find((d) => d.id === f.id)?.label),
    );
  });

  it("skips fields that are switched off and unknown ids", () => {
    const fields = base.common.fields.map((f) =>
      f.id === "irating" ? { ...f, visible: false } : f,
    );
    expect(widthHiddenLabels(leaderboard, fields, ["irating", "nope"])).toEqual([]);
    expect(widthHiddenLabels(leaderboard, fields, [])).toEqual([]);
  });
});

describe("resizeNote", () => {
  it("differs for Custom and has none when the mode is unknown", () => {
    expect(resizeNote("auto")).toBe("Turning a column on or off resizes the overlay to fit.");
    expect(resizeNote("compact")).toBe(resizeNote("auto"));
    expect(resizeNote("custom")).toContain("does not resize");
    expect(resizeNote(undefined)).toBeNull();
  });
});
