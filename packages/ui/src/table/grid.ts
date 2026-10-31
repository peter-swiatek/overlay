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

const GROW = "minmax(0, 1fr)";

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * CSS grid-template-columns for the visible columns. Rules:
 * - custom: each column is `(config.widthPct ?? defaultWidthPct) * scale / 100` as a `%`.
 *   If those add up to under 100 and a grow column exists, the first grow column becomes
 *   `minmax(0, 1fr)` and takes the rest; otherwise the percentages are used as they are.
 * - auto: `max-content` for fixed columns, `minmax(0, 1fr)` for grow columns. Scale is not used.
 * - compact: `<chars * scale / 100>ch` for fixed columns, `minmax(0, 1fr)` for grow columns.
 *   (The smaller cell padding comes from the stylesheet, not from here.)
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
  if (mode === "auto") {
    return visible.map((c) => (c.grow ? GROW : "max-content")).join(" ");
  }
  if (mode === "compact") {
    return visible.map((c) => (c.grow ? GROW : `${round(c.chars * scale)}ch`)).join(" ");
  }
  const widths = visible.map((c) => {
    const own = config.find((f) => f.id === c.id)?.widthPct ?? null;
    return (own ?? c.defaultWidthPct) * scale;
  });
  const sum = widths.reduce((a, b) => a + b, 0);
  const growIndex = visible.findIndex((c) => c.grow);
  return widths.map((w, i) => (sum < 100 && i === growIndex ? GROW : `${round(w)}%`)).join(" ");
}
