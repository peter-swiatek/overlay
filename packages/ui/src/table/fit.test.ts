import { describe, expect, it } from "vitest";
import type { FieldConfig } from "../types";
import {
  NOMINAL_TABLE_METRICS,
  columnFitPx,
  columnFloorPx,
  columnsToHide,
  tableWidths,
  withHidden,
  type FitColumn,
  type TableMetrics,
} from "./fit";
import { gridTemplate, type TableColumn } from "./grid";

// Round numbers keep the hand-computed expectations exact.
const M: TableMetrics = { chPx: 10, cellPadPx: 5 };

const FIXED: FitColumn = { id: "a", chars: 4, minChars: 3 };
const GROW: FitColumn = { id: "d", chars: 14, minChars: 10, grow: true };

describe("column floor and fit", () => {
  it("auto: floor = minChars + padding, fit = chars + padding", () => {
    expect(columnFloorPx(FIXED, M, "auto", 100)).toBe(40);
    expect(columnFitPx(FIXED, M, "auto", 100)).toBe(50);
    expect(columnFloorPx(GROW, M, "auto", 100)).toBe(110);
    expect(columnFitPx(GROW, M, "auto", 100)).toBe(150);
  });

  it("minChars defaults to chars", () => {
    const col: FitColumn = { id: "x", chars: 6 };
    expect(columnFloorPx(col, M, "auto", 100)).toBe(70);
    expect(columnFitPx(col, M, "auto", 100)).toBe(70);
  });

  it("compact: fixed columns are chars * scale with no padding, never below the floor", () => {
    expect(columnFloorPx(FIXED, M, "compact", 100)).toBe(40);
    expect(columnFitPx(FIXED, M, "compact", 100)).toBe(40);
    expect(columnFloorPx(FIXED, M, "compact", 50)).toBe(30);
    expect(columnFloorPx(FIXED, M, "compact", 150)).toBe(60);
  });

  it("compact: grow columns behave like auto and ignore the fine-tune", () => {
    expect(columnFloorPx(GROW, M, "compact", 50)).toBe(110);
    expect(columnFitPx(GROW, M, "compact", 150)).toBe(150);
  });

  it("auto ignores the fine-tune", () => {
    expect(columnFloorPx(FIXED, M, "auto", 50)).toBe(40);
    expect(columnFitPx(FIXED, M, "auto", 150)).toBe(50);
  });

  it("custom: the floor grows with the fine-tune but never shrinks below 100 %", () => {
    expect(columnFloorPx(FIXED, M, "custom", 50)).toBe(40);
    expect(columnFloorPx(FIXED, M, "custom", 100)).toBe(40);
    expect(columnFloorPx(FIXED, M, "custom", 150)).toBe(3 * 10 * 1.5 + 10);
  });
});

const COLUMNS: FitColumn[] = [
  { id: "pos", chars: 3 },
  { id: "car", chars: 4 },
  { id: "driver", chars: 14, minChars: 10, grow: true },
  { id: "gap", chars: 6 },
  { id: "sr", chars: 7, dropPriority: 50 },
  { id: "ir", chars: 8, dropPriority: 55 },
  { id: "int", chars: 6, dropPriority: 60 },
  { id: "last", chars: 8, dropPriority: 70 },
];

function config(visible: string[]): FieldConfig[] {
  return COLUMNS.map((c) => ({ id: c.id, visible: visible.includes(c.id), widthPct: null }));
}

const ALL = COLUMNS.map((c) => c.id);

describe("tableWidths", () => {
  it("sums the visible columns; minPx excludes droppable ones", () => {
    const w = tableWidths(COLUMNS, config(ALL), "auto", 100, M);
    // fit: (3+4+14+6+7+8+6+8) * 10 + 8 * 10
    expect(w.fitPx).toBe(560 + 80);
    // floor: (3+4+10+6+7+8+6+8) * 10 + 80
    expect(w.floorPx).toBe(520 + 80);
    // min: pos, car, driver, gap only
    expect(w.minPx).toBe((3 + 4 + 10 + 6) * 10 + 40);
  });

  it("counts only visible columns and skips unknown ids", () => {
    const cfg = [...config(["pos", "gap"]), { id: "nope", visible: true, widthPct: null }];
    const w = tableWidths(COLUMNS, cfg, "auto", 100, M);
    expect(w.fitPx).toBe(110);
    expect(w.minPx).toBe(w.floorPx);
  });

  it("has no fit in custom mode", () => {
    const w = tableWidths(COLUMNS, config(ALL), "custom", 100, M);
    expect(w.fitPx).toBeNull();
    expect(w.floorPx).toBe(600);
  });

  it("an empty table is zero wide", () => {
    expect(tableWidths(COLUMNS, config([]), "auto", 100, M)).toEqual({
      fitPx: 0,
      floorPx: 0,
      minPx: 0,
    });
  });
});

describe("columnsToHide", () => {
  const floorAll = 600;
  it("hides nothing when everything fits or the width is unusable", () => {
    expect(columnsToHide(COLUMNS, config(ALL), floorAll, "auto", 100, M)).toEqual([]);
    expect(columnsToHide(COLUMNS, config(ALL), 0, "auto", 100, M)).toEqual([]);
    expect(columnsToHide(COLUMNS, config(ALL), Number.NaN, "auto", 100, M)).toEqual([]);
    expect(columnsToHide(COLUMNS, config(ALL), -5, "auto", 100, M)).toEqual([]);
  });

  it("hides in ascending dropPriority and stops once the rest fit", () => {
    // sr floor 7*10+10 = 80
    expect(columnsToHide(COLUMNS, config(ALL), floorAll - 1, "auto", 100, M)).toEqual(["sr"]);
    // sr 80 + ir 90 = 170 removed -> 430
    expect(columnsToHide(COLUMNS, config(ALL), 430, "auto", 100, M)).toEqual(["sr", "ir"]);
    expect(columnsToHide(COLUMNS, config(ALL), 429, "auto", 100, M)).toEqual(["sr", "ir", "int"]);
  });

  it("allows half a pixel of slack", () => {
    expect(columnsToHide(COLUMNS, config(ALL), floorAll - 0.5, "auto", 100, M)).toEqual([]);
  });

  it("breaks priority ties with the later column in config order", () => {
    const cols: FitColumn[] = [
      { id: "k", chars: 4 },
      { id: "x", chars: 4, dropPriority: 10 },
      { id: "y", chars: 4, dropPriority: 10 },
    ];
    const cfg = cols.map((c) => ({ id: c.id, visible: true, widthPct: null }));
    expect(columnsToHide(cols, cfg, 130, "auto", 100, M)).toEqual(["y"]);
    expect(columnsToHide(cols, cfg, 70, "auto", 100, M)).toEqual(["y", "x"]);
  });

  it("never hides a column without a dropPriority, even when still too wide", () => {
    const hidden = columnsToHide(COLUMNS, config(ALL), 10, "auto", 100, M);
    expect(hidden).toEqual(["sr", "ir", "int", "last"]);
  });

  it("ignores invisible columns", () => {
    const cfg = config(["pos", "car", "driver", "gap", "last"]);
    expect(columnsToHide(COLUMNS, cfg, 10_000, "auto", 100, M)).toEqual([]);
    // floors: 40+50+110+70+90 = 360; 300 wide hides only "last"
    expect(columnsToHide(COLUMNS, cfg, 300, "auto", 100, M)).toEqual(["last"]);
  });
});

describe("withHidden", () => {
  it("returns the same array when nothing is hidden", () => {
    const cfg = config(ALL);
    expect(withHidden(cfg, [])).toBe(cfg);
  });

  it("sets the given ids invisible without touching the input", () => {
    const cfg = config(ALL);
    const out = withHidden(cfg, ["sr", "last"]);
    expect(out.filter((f) => !f.visible).map((f) => f.id)).toEqual(["sr", "last"]);
    expect(cfg.every((f) => f.visible)).toBe(true);
  });
});

describe("agreement with gridTemplate", () => {
  // Evaluates "calc(Nch + 2 * var(--ov-cell-pad-x, 7px))" and bare "Nch" tracks at metrics M.
  function minimumsPx(template: string): number {
    const tracks = template.match(
      /minmax\([^()]*(?:\([^()]*(?:\([^()]*\)[^()]*)*\)[^()]*)*\)|\S+/g,
    );
    if (tracks === null) return 0;
    return tracks.reduce((sum, track) => {
      const bare = /^([\d.]+)ch$/.exec(track);
      if (bare) return sum + Number(bare[1]) * M.chPx;
      const calc = /calc\(([\d.]+)ch \+ 2 \* var/.exec(track);
      if (calc) return sum + Number(calc[1]) * M.chPx + 2 * M.cellPadPx;
      throw new Error(`unparsed track ${track}`);
    }, 0);
  }

  const TABLE_COLUMNS: TableColumn<unknown>[] = COLUMNS.map((c) => ({
    ...c,
    label: c.id,
    defaultWidthPct: 10,
    render: () => null,
  }));

  const sets = [ALL, ["pos", "driver", "last"], ["car", "gap", "sr", "ir"]];
  for (const mode of ["auto", "compact", "custom"] as const) {
    for (const scale of [50, 100, 150]) {
      it(`${mode} at ${scale} %: floorPx equals the sum of the template minimums`, () => {
        for (const visible of sets) {
          const cfg = config(visible);
          const template = gridTemplate(TABLE_COLUMNS, cfg, mode, scale);
          const w = tableWidths(COLUMNS, cfg, mode, scale, M);
          expect(w.floorPx).toBeCloseTo(minimumsPx(template), 1);
        }
      });
    }
  }

  it("the nominal metrics are Inter 14 px with 7 px padding", () => {
    expect(NOMINAL_TABLE_METRICS).toEqual({ chPx: 8.6, cellPadPx: 7 });
  });
});
