import type { OverlayManifest, OverlaySettingsPatch } from "@overlay/overlays/contract";
import { columnFloorChars } from "@overlay/overlays/fields";
import { columnFloorPct } from "@overlay/ui";
import type { FieldConfig } from "@overlay/ui/types";
import { fieldDef, setFieldPatch, shownWidthPct } from "./model";

/** What the preview measures; both optional until its first measurement. */
export interface FloorInputs {
  tableWidthPx?: number;
  chPx?: number;
  cellPadPx?: number;
  /** The Fine-tune option (width scale), percent. Default 100. */
  widthScalePct?: number;
}

/** Used until the preview has measured the real ch width. */
export const FALLBACK_CH_PX = 7;
export const FALLBACK_CELL_PAD_PX = 8;
/** The column that takes the spare width when the total is under 100 % (see `gridTemplate`). */
export const GROW_FIELD_ID = "driver";

/**
 * Narrowest width (whole %, in the stored unit the slider edits) the slider allows for a column. Table width falls back to the overlay's
 * window width and ch to 7 px. Columns without a known floor (not a driver column) get 1.
 */
export function floorPctFor(
  manifest: OverlayManifest,
  fieldId: string,
  inputs: FloorInputs = {},
): number {
  const def = fieldDef(manifest, fieldId);
  const driverFloor = columnFloorChars(fieldId);
  const chars = driverFloor ?? def?.minChars ?? def?.chars;
  if (chars === undefined) return 1;
  const width = inputs.tableWidthPx ?? manifest.defaultSize.width;
  const fineTune = inputs.widthScalePct ?? 100;
  const drawn = columnFloorPct(
    chars,
    width,
    inputs.chPx ?? FALLBACK_CH_PX,
    inputs.cellPadPx ?? FALLBACK_CELL_PAD_PX,
    fineTune,
  );
  // The grid draws a stored width times the Fine-tune scale, so convert the drawn floor back
  // to the stored unit the slider edits.
  if (!(fineTune > 0)) return drawn;
  return Math.min(100, Math.max(1, Math.ceil((drawn * 100) / fineTune - 1e-9)));
}

/** The width a slider shows: the stored or default width, never below the floor. */
export function sliderValue(
  config: FieldConfig,
  manifest: OverlayManifest,
  floorPct: number,
): number {
  return Math.max(floorPct, shownWidthPct(config, fieldDef(manifest, config.id)));
}

export interface WidthTotal {
  /** Sum of the visible columns' widths (with the Fine-tune scale), whole %. */
  totalPct: number;
  over: boolean;
  /** Label of the column that takes the rest, when the total is under 100 % and it is visible. */
  growLabel: string | null;
}

export function widthTotal(
  manifest: OverlayManifest,
  fields: readonly FieldConfig[],
  widthScalePct = 100,
): WidthTotal {
  const visible = fields.filter((f) => f.visible);
  const sum = visible.reduce((a, f) => a + shownWidthPct(f, fieldDef(manifest, f.id)), 0);
  const totalPct = Math.round((sum * widthScalePct) / 100);
  const grow = visible.find((f) => f.id === GROW_FIELD_ID);
  return {
    totalPct,
    over: totalPct > 100,
    growLabel: grow ? (fieldDef(manifest, grow.id)?.label ?? grow.id) : null,
  };
}

export function totalMessage(total: WidthTotal): string {
  if (total.over) return "Columns are wider than the table; the overlay will widen to fit.";
  const head = `Total ${total.totalPct} %.`;
  return total.growLabel === null ? head : `${head} The ${total.growLabel} column takes the rest.`;
}

export type WidthMode = "custom" | "auto" | "compact";

export interface WidthChange {
  fields: FieldConfig[];
  /** True when the caller must also set Column width to Custom in the same patch. */
  setCustom: boolean;
}

/**
 * A slider move on one column. Widths only apply in Custom mode, so from Auto or Compact the change
 * switches the mode too. `mode` undefined (not known by the caller) never switches.
 */
export function planWidthChange(
  fields: readonly FieldConfig[],
  id: string,
  widthPct: number,
  mode: WidthMode | undefined,
): WidthChange {
  return {
    fields: setFieldPatch(fields, id, { widthPct }),
    setCustom: mode === "auto" || mode === "compact",
  };
}

/**
 * The single patch for a width change from Auto or Compact: the new column list and Column width
 * set to Custom together, so the sliders are never left looking broken. Send it debounced under
 * the "fields-width" key like any other width change.
 */
export function customWidthPatch(fields: FieldConfig[]): OverlaySettingsPatch {
  return { common: { fields }, options: { "column-width": "custom" } };
}

/**
 * Labels (manifest labels, config order) of the visible fields the overlay currently hides because
 * its window is too narrow. `hiddenIds` is what the overlay reports in its `data-hidden-columns`.
 */
export function widthHiddenLabels(
  manifest: OverlayManifest,
  fields: readonly FieldConfig[],
  hiddenIds: readonly string[],
): string[] {
  return fields
    .filter((f) => f.visible && hiddenIds.includes(f.id))
    .map((f) => fieldDef(manifest, f.id)?.label ?? f.id);
}

/** The note about what turning a column on or off does to the window; null when the mode is unknown. */
export function resizeNote(mode: WidthMode | undefined): string | null {
  if (mode === undefined) return null;
  return mode === "custom"
    ? "Column widths are shares of the overlay width; it does not resize when you turn columns on or off."
    : "Turning a column on or off resizes the overlay to fit.";
}
