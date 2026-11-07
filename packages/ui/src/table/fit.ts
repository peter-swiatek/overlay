/**
 * Column width planning in px, without React or CSS, so the Electron main process can import it
 * (`@overlay/ui/fit`).
 *
 * The floor maths below copies `gridTemplate()` in grid.ts (the CSS the table really uses): a
 * change to one needs the same change in the other. fit.test.ts cross-checks the two.
 */
import type { ColumnWidthMode, FieldConfig } from "../types";

/** What width planning needs from a column; TableColumn satisfies it. */
export interface FitColumn {
  id: string;
  /** Typical content width in characters (the column's share of the fit width). */
  chars: number;
  /** Floor in characters; defaults to `chars`. */
  minChars?: number;
  /** Takes spare width (driver name). */
  grow?: boolean;
  /** Lower numbers hide first when the table is too narrow; undefined = never hidden. */
  dropPriority?: number;
}

/** The table font, measured in the overlay's CSS px at 100 % scale (zoom 1). */
export interface TableMetrics {
  /** Width of one `ch` of the table font. */
  chPx: number;
  /** The theme's --ov-cell-pad-x. */
  cellPadPx: number;
}

/** Inter 14 px, 7 px padding: used for manifest default sizes and until a window reports. */
export const NOMINAL_TABLE_METRICS: TableMetrics = { chPx: 8.6, cellPadPx: 7 };

export interface TableWidths {
  /** What the visible columns want, each at its typical `chars`; null in custom mode (no fit). */
  fitPx: number | null;
  /** Every visible column at its floor: below this, columns start to hide. */
  floorPx: number;
  /** Only the never-hidden visible columns at their floors: the window minimum. */
  minPx: number;
}

/** Narrowest track of one column, px. Mirrors gridTemplate's minimum for the mode. */
export function columnFloorPx(
  column: FitColumn,
  metrics: TableMetrics,
  mode: ColumnWidthMode,
  fineTunePct: number,
): number {
  const floorChars = column.minChars ?? column.chars;
  const { chPx, cellPadPx } = metrics;
  const s = fineTunePct / 100;
  if (mode === "compact" && column.grow !== true) {
    return Math.max(column.chars * s, floorChars) * chPx;
  }
  if (mode === "custom") return floorChars * chPx * Math.max(1, s) + 2 * cellPadPx;
  return floorChars * chPx + 2 * cellPadPx;
}

/** Track the column wants at its typical width, px; never below its floor. */
export function columnFitPx(
  column: FitColumn,
  metrics: TableMetrics,
  mode: ColumnWidthMode,
  fineTunePct: number,
): number {
  const floor = columnFloorPx(column, metrics, mode, fineTunePct);
  if (mode === "custom" || (mode === "compact" && column.grow !== true)) return floor;
  return Math.max(floor, column.chars * metrics.chPx + 2 * metrics.cellPadPx);
}

function visibleColumns(
  columns: readonly FitColumn[],
  config: readonly FieldConfig[],
): FitColumn[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const out: FitColumn[] = [];
  for (const field of config) {
    const column = byId.get(field.id);
    if (field.visible && column) out.push(column);
  }
  return out;
}

/** Widths of the visible columns of `config` (in config order; unknown ids skipped). */
export function tableWidths(
  columns: readonly FitColumn[],
  config: readonly FieldConfig[],
  mode: ColumnWidthMode,
  fineTunePct: number,
  metrics: TableMetrics,
): TableWidths {
  let fit = 0;
  let floor = 0;
  let min = 0;
  for (const c of visibleColumns(columns, config)) {
    const f = columnFloorPx(c, metrics, mode, fineTunePct);
    floor += f;
    if (c.dropPriority === undefined) min += f;
    fit += columnFitPx(c, metrics, mode, fineTunePct);
  }
  return { fitPx: mode === "custom" ? null : fit, floorPx: floor, minPx: min };
}

/**
 * Ids of the visible columns to hide so the rest fit in `availablePx`, in hide order: ascending
 * dropPriority, ties broken by the later column in config order. Never hides a column without a
 * dropPriority; returns [] when everything fits or availablePx is not a positive number.
 */
export function columnsToHide(
  columns: readonly FitColumn[],
  config: readonly FieldConfig[],
  availablePx: number,
  mode: ColumnWidthMode,
  fineTunePct: number,
  metrics: TableMetrics,
): string[] {
  if (!(availablePx > 0)) return [];
  const visible = visibleColumns(columns, config);
  const floors = visible.map((c) => columnFloorPx(c, metrics, mode, fineTunePct));
  let total = floors.reduce((a, b) => a + b, 0);
  const order = visible
    .map((c, index) => ({ c, index }))
    .filter((e) => e.c.dropPriority !== undefined)
    .sort((a, b) => (a.c.dropPriority ?? 0) - (b.c.dropPriority ?? 0) || b.index - a.index);
  const hidden: string[] = [];
  for (const e of order) {
    if (total <= availablePx + 0.5) break;
    hidden.push(e.c.id);
    total -= floors[e.index] ?? 0;
  }
  return hidden;
}

/** `config` with the given ids set to visible: false (same array when `hidden` is empty). */
export function withHidden(
  config: readonly FieldConfig[],
  hidden: readonly string[],
): FieldConfig[] {
  if (hidden.length === 0) return config as FieldConfig[];
  return config.map((f) => (hidden.includes(f.id) ? { ...f, visible: false } : f));
}
