import { tableWidths, type FitColumn, type TableMetrics, type TableWidths } from "@overlay/ui/fit";
import type { ColumnWidthMode } from "@overlay/ui/types";
import type { OverlayInstanceSettings, OverlayManifest } from "../contract";
import { columnFloorChars } from "./fields";

/** FitColumns for a table manifest, matching what driverColumns gives DataTable (grow = driver). */
export function fitColumnsFor(manifest: OverlayManifest): FitColumn[] {
  return manifest.fields.map((def) => ({
    id: def.id,
    chars: def.chars ?? 6,
    minChars: columnFloorChars(def.id) ?? def.minChars,
    grow: def.id === "driver" ? true : undefined,
    dropPriority: def.dropPriority,
  }));
}

function widthMode(value: unknown): ColumnWidthMode {
  return value === "custom" || value === "compact" ? value : "auto";
}

/** The table widths for an overlay's current settings at 100 % scale; null for non-table manifests. */
export function tableWidthsFor(
  manifest: OverlayManifest,
  settings: OverlayInstanceSettings,
  metrics: TableMetrics,
): TableWidths | null {
  if (!manifest.table) return null;
  const fineTune = settings.options["width-fine-tune"];
  return tableWidths(
    fitColumnsFor(manifest),
    settings.common.fields,
    widthMode(settings.options["column-width"]),
    typeof fineTune === "number" ? fineTune : 100,
    metrics,
  );
}
