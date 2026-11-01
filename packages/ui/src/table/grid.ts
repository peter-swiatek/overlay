import type { ReactNode } from "react";
import type { ColumnWidthMode, FieldConfig } from "../types";

export interface TableColumn<Row> {
  /** Matches FieldConfig.id. */
  id: string;
  /** Header cell text. */
  label: string;
  align?: "left" | "center" | "right";
  /** Takes spare width in auto and compact modes (driver name). */
  grow?: boolean;
  /** Typical content width in characters, for auto and compact. */
  chars: number;
  /**
   * Narrowest the column may get, in characters (defaults to `chars`). The column never shrinks
   * below this, whatever the width mode, so its text stays readable.
   */
  minChars?: number;
  /** Custom mode width (% of the table) when FieldConfig.widthPct is null. */
  defaultWidthPct: number;
  render(row: Row): ReactNode;
}

/** Visible columns in the order of `config`; columns missing from config are left out. */
export function orderedColumns<Row>(
  columns: readonly TableColumn<Row>[],
  config: readonly FieldConfig[],
): TableColumn<Row>[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const out: TableColumn<Row>[] = [];
  for (const field of config) {
    const column = byId.get(field.id);
    if (field.visible && column) out.push(column);
  }
  return out;
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** The smallest track size of a column: its minimum characters plus the cell padding both sides. */
function minTrack<Row>(column: TableColumn<Row>, scale: number): string {
  const chars = (column.minChars ?? column.chars) * scale;
  return `calc(${round(chars)}ch + 2 * var(--ov-cell-pad-x, 8px))`;
}

/**
 * CSS grid-template-columns for the visible columns. Every column has a floor (`minChars`, else
 * `chars`, plus cell padding) so text stays readable at any overlay width. Rules:
 * - custom: each column is `minmax(<floor>, (config.widthPct ?? defaultWidthPct) * scale / 100 %)`.
 *   If those add up to under 100 and a grow column exists, the first grow column becomes
 *   `minmax(<floor>, 1fr)` and takes the rest. The floor grows with the scale but never shrinks.
 * - auto: `minmax(<floor>, max-content)` for fixed columns, `minmax(<floor>, 1fr)` for grow
 *   columns. Scale is not used.
 * - compact: `<chars * scale / 100>ch` for fixed columns (never below the floor in characters),
 *   `minmax(<floor>, 1fr)` for grow columns. The smaller cell padding comes from the stylesheet.
 * An empty column list gives an empty string.
 */
export function gridTemplate<Row>(
  columns: readonly TableColumn<Row>[],
  config: readonly FieldConfig[],
  mode: ColumnWidthMode,
  scalePct: number,
): string {
  const visible = orderedColumns(columns, config);
  const scale = scalePct / 100;
  const grow = (c: TableColumn<Row>, s: number): string => `minmax(${minTrack(c, s)}, 1fr)`;
  if (mode === "auto") {
    return visible
      .map((c) => (c.grow ? grow(c, 1) : `minmax(${minTrack(c, 1)}, max-content)`))
      .join(" ");
  }
  if (mode === "compact") {
    return visible
      .map((c) =>
        c.grow ? grow(c, 1) : `${round(Math.max(c.chars * scale, c.minChars ?? c.chars))}ch`,
      )
      .join(" ");
  }
  const floorScale = Math.max(1, scale);
  const widths = visible.map((c) => {
    const own = config.find((f) => f.id === c.id)?.widthPct ?? null;
    return (own ?? c.defaultWidthPct) * scale;
  });
  const sum = widths.reduce((a, b) => a + b, 0);
  const growIndex = visible.findIndex((c) => c.grow);
  return visible
    .map((c, i) =>
      sum < 100 && i === growIndex
        ? grow(c, floorScale)
        : `minmax(${minTrack(c, floorScale)}, ${round(widths[i] ?? 0)}%)`,
    )
    .join(" ");
}

/**
 * The narrowest a column may be, as a whole % of the table, for the settings width slider. Mirrors
 * `minTrack()`: `(floorChars * chPx * max(1, scale) + 2 * pad) / tableWidthPx * 100`, rounded up and
 * clamped to 1..100. `scalePct` is the width fine-tune (the floor grows with it, never shrinks).
 */
export function columnFloorPct(
  floorChars: number,
  tableWidthPx: number,
  chPx: number,
  cellPadPx: number,
  scalePct: number,
): number {
  if (!(tableWidthPx > 0)) return 100;
  const scale = Math.max(1, scalePct / 100);
  const pct = ((floorChars * chPx * scale + 2 * cellPadPx) / tableWidthPx) * 100;
  return Math.min(100, Math.max(1, Math.ceil(pct - 1e-9)));
}
