import { tableWidths, type FitColumn, type TableMetrics, type TableWidths } from "@overlay/ui/fit";
import type { ColumnWidthMode } from "@overlay/ui/types";
import type { OverlayInstanceSettings, OverlayManifest } from "../contract";
import type { SimName } from "@overlay/sim-core/types";
import {
  IRATING_CHANGE_KEY,
  IRATING_CHARS,
  columnFloorChars,
  fieldsForSim,
  type IRatingSize,
} from "./fields";

/**
 * The iRating pill size a manifest's settings ask for: "auto" when the manifest has no iRating
 * change toggle, else "wide" with the toggle on and "narrow" with it off.
 */
export function iRatingSizeFor(
  manifest: OverlayManifest,
  settings?: OverlayInstanceSettings,
): IRatingSize {
  const field = manifest.settings.find((f) => f.key === IRATING_CHANGE_KEY);
  if (field === undefined) return "auto";
  const value = settings?.options[IRATING_CHANGE_KEY] ?? field.default;
  return value === true ? "wide" : "narrow";
}

/** FitColumns for a table manifest, matching what driverColumns gives DataTable (grow = driver). */
export function fitColumnsFor(
  manifest: OverlayManifest,
  settings?: OverlayInstanceSettings,
): FitColumn[] {
  const size = iRatingSizeFor(manifest, settings);
  return manifest.fields.map((def) => ({
    id: def.id,
    chars: def.id === "irating" && size !== "auto" ? IRATING_CHARS[size] : (def.chars ?? 6),
    minChars:
      def.id === "irating" && size !== "auto"
        ? IRATING_CHARS[size]
        : (columnFloorChars(def.id) ?? def.minChars),
    grow: def.id === "driver" ? true : undefined,
    dropPriority: def.dropPriority,
  }));
}

function widthMode(value: unknown): ColumnWidthMode {
  return value === "custom" || value === "compact" ? value : "auto";
}

/**
 * The table widths for an overlay's current settings at 100 % scale; null for non-table manifests.
 * With a known `sim`, columns that only exist in the other sim are left out, as the overlay does.
 */
export function tableWidthsFor(
  manifest: OverlayManifest,
  settings: OverlayInstanceSettings,
  metrics: TableMetrics,
  sim: SimName | null = null,
): TableWidths | null {
  if (!manifest.table) return null;
  const fineTune = settings.options["width-fine-tune"];
  return tableWidths(
    fitColumnsFor(manifest, settings),
    fieldsForSim(settings.common.fields, sim),
    widthMode(settings.options["column-width"]),
    typeof fineTune === "number" ? fineTune : 100,
    metrics,
  );
}
