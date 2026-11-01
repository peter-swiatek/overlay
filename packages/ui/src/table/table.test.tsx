import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FieldConfig } from "../types";
import { DataTable, gridTemplate, orderedColumns, type TableColumn } from "./index";

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
const floor = (chars: number): string => `calc(${chars}ch + 2 * var(--ov-cell-pad-x, 8px))`;

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
    expect(html).toContain("--ov-section-colour:#ff0000");
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
