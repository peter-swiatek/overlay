import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FieldConfig } from "../types";
import { DataTable, columnFloorPct, gridTemplate, orderedColumns, type TableColumn } from "./index";

interface Car {
  id: number;
  name: string;
  pos: number;
  own?: boolean;
}

const COLUMNS: TableColumn<Car>[] = [
  { id: "pos", label: "Pos", align: "right", chars: 3, defaultWidthPct: 10, render: (r) => r.pos },
  {
    id: "name",
    label: "Driver",
    grow: true,
    chars: 20,
    defaultWidthPct: 60,
    render: (r) => r.name,
  },
  { id: "gap", label: "Gap", align: "right", chars: 6, defaultWidthPct: 30, render: () => "+1.0" },
];

const CONFIG: FieldConfig[] = [
  { id: "name", visible: true, widthPct: null },
  { id: "pos", visible: true, widthPct: 20 },
  { id: "gap", visible: false, widthPct: null },
  { id: "ghost", visible: true, widthPct: null },
];

describe("orderedColumns", () => {
  it("keeps visible columns in config order and drops unknown ones", () => {
    expect(orderedColumns(COLUMNS, CONFIG).map((c) => c.id)).toEqual(["name", "pos"]);
  });
  it("leaves out columns missing from config", () => {
    expect(
      orderedColumns(COLUMNS, [{ id: "pos", visible: true, widthPct: null }]).map((c) => c.id),
    ).toEqual(["pos"]);
  });
});

/** The floor of a column: its characters plus the cell padding on both sides. */
const floor = (chars: number): string => `calc(${chars}ch + 2 * var(--ov-cell-pad-x, 7px))`;

describe("gridTemplate", () => {
  it("custom: widths times scale; grow column takes the rest when the sum is under 100", () => {
    // name 60, pos 20 -> 80 < 100
    expect(gridTemplate(COLUMNS, CONFIG, "custom", 100)).toBe(
      `minmax(${floor(20)}, 1fr) minmax(${floor(3)}, 20%)`,
    );
    const full: FieldConfig[] = [
      { id: "pos", visible: true, widthPct: 20 },
      { id: "name", visible: true, widthPct: 50 },
      { id: "gap", visible: true, widthPct: 30 },
    ];
    expect(gridTemplate(COLUMNS, full, "custom", 100)).toBe(
      `minmax(${floor(3)}, 20%) minmax(${floor(20)}, 50%) minmax(${floor(6)}, 30%)`,
    );
    expect(gridTemplate(COLUMNS, full, "custom", 50)).toBe(
      `minmax(${floor(3)}, 10%) minmax(${floor(20)}, 1fr) minmax(${floor(6)}, 15%)`,
    );
    // The floor grows with the scale, but never shrinks below the base width.
    expect(gridTemplate(COLUMNS, full, "custom", 150)).toBe(
      `minmax(${floor(4.5)}, 30%) minmax(${floor(30)}, 75%) minmax(${floor(9)}, 45%)`,
    );
  });
  it("custom: a tiny percentage still has a floor", () => {
    const cfg: FieldConfig[] = [
      { id: "pos", visible: true, widthPct: 1 },
      { id: "gap", visible: true, widthPct: 1 },
    ];
    expect(gridTemplate(COLUMNS, cfg, "custom", 100)).toBe(
      `minmax(${floor(3)}, 1%) minmax(${floor(6)}, 1%)`,
    );
  });
  it("custom: falls back to the default width", () => {
    const cfg: FieldConfig[] = [
      { id: "pos", visible: true, widthPct: null },
      { id: "gap", visible: true, widthPct: null },
    ];
    expect(gridTemplate(COLUMNS, cfg, "custom", 100)).toBe(
      `minmax(${floor(3)}, 10%) minmax(${floor(6)}, 30%)`,
    );
  });
  it("auto: floor to max-content and a flexible grow column, scale ignored", () => {
    expect(gridTemplate(COLUMNS, CONFIG, "auto", 120)).toBe(
      `minmax(${floor(20)}, 1fr) minmax(${floor(3)}, max-content)`,
    );
  });
  it("minChars lowers the floor below chars", () => {
    const cols: TableColumn<Car>[] = COLUMNS.map((c) =>
      c.id === "name" ? { ...c, minChars: 8 } : c,
    );
    expect(gridTemplate(cols, CONFIG, "auto", 100)).toBe(
      `minmax(${floor(8)}, 1fr) minmax(${floor(3)}, max-content)`,
    );
  });
  it("compact: ch widths scaled, grow column flexible", () => {
    expect(gridTemplate(COLUMNS, CONFIG, "compact", 100)).toBe(`minmax(${floor(20)}, 1fr) 3ch`);
    expect(gridTemplate(COLUMNS, CONFIG, "compact", 150)).toBe(`minmax(${floor(20)}, 1fr) 4.5ch`);
  });
  it("compact: never narrower than minChars", () => {
    const cols: TableColumn<Car>[] = COLUMNS.map((c) =>
      c.id === "pos" ? { ...c, minChars: 3 } : c,
    );
    expect(gridTemplate(cols, CONFIG, "compact", 50)).toBe(`minmax(${floor(20)}, 1fr) 3ch`);
  });
  it("returns an empty string without visible columns", () => {
    expect(gridTemplate(COLUMNS, [], "auto", 100)).toBe("");
  });
});

describe("DataTable markup", () => {
  const rows: Car[] = [
    { id: 1, name: "Max Example", pos: 1 },
    { id: 2, name: "José María Pérez", pos: 2, own: true },
    { id: 3, name: "Zofia Świątkowska", pos: 3 },
  ];

  it("renders sections with coloured bars, own row, alternate rows and hidden columns", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={COLUMNS}
        config={CONFIG}
        sections={[
          { key: "a", label: "GTP", colour: "#ff0000", rows: rows.slice(0, 2) },
          { key: "b", label: "GT3", colour: null, rows: rows.slice(2) },
        ]}
        rowKey={(r) => r.id}
        widthMode="custom"
        showHeader
        isOwnRow={(r) => r.own === true}
        rowClassName={(r) => (r.pos === 3 ? "extra" : undefined)}
        rowStyle={(r) =>
          r.pos === 3 ? ({ "--row-colour": "#123456" } as CSSProperties) : undefined
        }
      />,
    );
    expect(html).toContain(
      `grid-template-columns:minmax(${floor(20)}, 1fr) minmax(${floor(3)}, 20%)`,
    );
    expect(html).toContain("--class-color:#ff0000");
    expect(html).toContain("GTP");
    expect(html).toContain("GT3");
    expect(html.match(/ov-row--own/g)).toHaveLength(1);
    expect(html.match(/ov-row--alt/g)).toHaveLength(1);
    expect(html).toContain("ov-row extra");
    expect(html.match(/--row-colour:#123456/g)).toHaveLength(1);
    expect(html).toContain("Driver");
    expect(html).not.toContain("Gap");
    expect(html).not.toContain("+1.0");
  });

  it("renders the class band with tab, meta and class colour", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={COLUMNS}
        config={CONFIG}
        sections={[
          { key: "a", label: "GTP", colour: "#ff0000", rows, meta: <b>12 cars</b> },
          { key: "b", label: "GT3", colour: null, rows: [] },
        ]}
        rowKey={(r) => r.id}
        widthMode="auto"
        showHeader={false}
      />,
    );
    expect(html).toContain('class="ov-class-band ov-section-bar" style="--class-color:#ff0000"');
    expect(html).toContain('<span class="ov-class-tab">GTP</span>');
    expect(html).toContain('<span class="ov-class-meta"><b>12 cars</b></span>');
    expect(html.match(/ov-class-meta/g)).toHaveLength(1);
    expect(html.match(/ov-class-band/g)).toHaveLength(2);
  });

  it("puts cellClassName on body cells only", () => {
    const cols = COLUMNS.map((c) => (c.id === "pos" ? { ...c, cellClassName: "ov-cell--pos" } : c));
    const html = renderToStaticMarkup(
      <DataTable
        columns={cols}
        config={CONFIG}
        rows={rows}
        rowKey={(r) => r.id}
        widthMode="auto"
        showHeader
      />,
    );
    expect(html.match(/ov-cell--pos/g)).toHaveLength(rows.length);
    expect(html).toMatch(/ov-cell ov-cell--right ov-cell--pos" role="cell"/);
    expect(html).toMatch(/ov-cell ov-cell--right" role="columnheader"/);
  });

  it("marks yellow rows, alone or together with the own row", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={COLUMNS}
        config={CONFIG}
        rows={rows}
        rowKey={(r) => r.id}
        widthMode="auto"
        showHeader={false}
        isOwnRow={(r) => r.own === true}
        isYellowRow={(r) => r.pos === 1 || r.pos === 2}
      />,
    );
    expect(html.match(/ov-row--yellow/g)).toHaveLength(2);
    expect(html.match(/ov-row--own/g)).toHaveLength(1);
    expect(html).toMatch(/class="ov-row ov-row--alt ov-row--own ov-row--yellow"/);
  });

  it("omits the header when hidden and renders flat rows", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={COLUMNS}
        config={CONFIG}
        rows={rows}
        rowKey={(r) => r.id}
        widthMode="auto"
        showHeader={false}
      />,
    );
    expect(html).not.toContain("ov-row--header");
    expect(html).not.toContain("ov-section");
    expect(html).toContain("ov-table--auto");
    expect(html).toContain("Max Example");
  });
});

describe("columnFloorPct", () => {
  /** Evaluates the first (floor) argument of a `minmax(calc(Nch + 2 * var(...)), ...)` track. */
  function drawnFloorPx(track: string, chPx: number, padPx: number): number {
    const m = /^minmax\(calc\(([\d.]+)ch \+ 2 \* var\(--ov-cell-pad-x, 7px\)\)/.exec(track);
    if (!m) throw new Error(`unexpected track ${track}`);
    return Number(m[1]) * chPx + 2 * padPx;
  }

  it("matches the floor gridTemplate draws, for several widths and scales", () => {
    const config: FieldConfig[] = [
      { id: "pos", visible: true, widthPct: 5 },
      { id: "gap", visible: true, widthPct: 5 },
    ];
    for (const [tableWidth, ch, scale] of [
      [400, 7, 100],
      [650, 8.4, 100],
      [900, 7, 130],
    ] as const) {
      const tracks = gridTemplate(COLUMNS, config, "custom", scale).split(/ (?=minmax)/);
      const cols = orderedColumns(COLUMNS, config);
      cols.forEach((col, i) => {
        const px = drawnFloorPx(tracks[i] ?? "", ch, 8);
        const pct = columnFloorPct(col.minChars ?? col.chars, tableWidth, ch, 8, scale);
        expect(pct).toBe(Math.min(100, Math.max(1, Math.ceil((px / tableWidth) * 100 - 1e-9))));
        expect(pct).toBeGreaterThanOrEqual((px / tableWidth) * 100);
      });
    }
  });

  it("rounds up, clamps to 1..100 and never shrinks below scale 100", () => {
    expect(columnFloorPct(6, 400, 7, 8, 100)).toBe(15); // 58 px / 400 = 14.5
    expect(columnFloorPct(6, 400, 7, 8, 50)).toBe(15);
    expect(columnFloorPct(6, 400, 7, 8, 200)).toBe(25); // 100 px / 400
    expect(columnFloorPct(1, 100000, 7, 8, 100)).toBe(1);
    expect(columnFloorPct(50, 100, 7, 8, 100)).toBe(100);
    expect(columnFloorPct(5, 0, 7, 8, 100)).toBe(100);
  });
});

describe("own-row highlight CSS", () => {
  const css = readFileSync(join(__dirname, "table.css"), "utf8");

  it("starts after the position and car-number cells, except on a yellow row", () => {
    expect(css).toContain(".ov-row--own:not(.ov-row--yellow) > .ov-cell--pos,");
    expect(css).toContain(".ov-row--own:not(.ov-row--yellow) > .ov-cell--pos-fade {");
    expect(css).toContain(".ov-row--own.ov-row--alt:not(.ov-row--yellow) > .ov-cell--pos-fade {");
  });
});
