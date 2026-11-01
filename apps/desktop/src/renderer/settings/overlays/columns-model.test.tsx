import type { OverlayManifest } from "@overlay/overlays/contract";
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
  sliderValue,
  totalMessage,
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

  it("grows with the Fine-tune scale and is 1 for unknown columns", () => {
    const at = (widthScalePct: number) =>
      floorPctFor(leaderboard, "gap", { tableWidthPx: 400, chPx: 7, widthScalePct });
    expect(at(150)).toBeGreaterThan(at(100));
    expect(at(60)).toBe(at(100));
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
