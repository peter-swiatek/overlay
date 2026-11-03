import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { tableWidthsFor } from "@overlay/overlays/table-fit";
import type { TableMetrics } from "@overlay/ui/fit";
import type { Bounds } from "../shared/types";
import { clampToWorkArea, scaleSize } from "./layout";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validates a renderer's TableMetrics report: chPx 1..100, cellPadPx 0..100, else undefined. */
export function parseTableMetrics(value: unknown): TableMetrics | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const chPx = v["chPx"];
  const cellPadPx = v["cellPadPx"];
  if (!isFiniteNumber(chPx) || !isFiniteNumber(cellPadPx)) return undefined;
  if (chPx < 1 || chPx > 100 || cellPadPx < 0 || cellPadPx > 100) return undefined;
  return { chPx, cellPadPx };
}

export interface FitTarget {
  /** Scaled window width the columns want; null = no fit (custom mode or not a table). */
  fitWidth: number | null;
  /** Scaled window minimum width from the never-hidden columns (0 when unknown). */
  minWidth: number;
}

/** tableWidthsFor scaled by scalePct (Math.ceil); { fitWidth: null, minWidth: 0 } for non-tables. */
export function fitTarget(
  manifest: OverlayManifest,
  settings: OverlayInstanceSettings,
  metrics: TableMetrics,
): FitTarget {
  const widths = tableWidthsFor(manifest, settings, metrics);
  if (!widths) return { fitWidth: null, minWidth: 0 };
  const scale = settings.common.scalePct / 100;
  return {
    fitWidth: widths.fitPx === null ? null : Math.ceil(widths.fitPx * scale),
    minWidth: Math.ceil(widths.minPx * scale),
  };
}

/**
 * New bounds when the fit changed since it was last applied, else null. Keeps x, y and height;
 * width = max(fitWidth, minWidth), then clamped to the work area. Returns the fitWidth to store
 * (the target even when clamped, so a clamped window is not retried on every change).
 */
export function planAutoWidth(input: {
  bounds: Bounds;
  storedFitWidth: number | undefined;
  target: FitTarget;
  area: Bounds;
}): { bounds: Bounds | null; fitWidth: number | undefined } {
  const { bounds, storedFitWidth, target, area } = input;
  const fit = target.fitWidth;
  if (fit === null) return { bounds: null, fitWidth: storedFitWidth };
  if (storedFitWidth !== undefined && Math.abs(storedFitWidth - fit) < 1) {
    return { bounds: null, fitWidth: storedFitWidth };
  }
  const wanted = Math.max(fit, target.minWidth);
  const room = Math.max(target.minWidth, area.x + area.width - bounds.x);
  const width = Math.min(wanted, room);
  return {
    bounds: width === bounds.width ? null : { ...bounds, width },
    fitWidth: fit,
  };
}

/** Window size for a sizeByOption manifest when the option value differs from sizedFor (undefined sizedFor = record only). */
export function planOptionSize(input: {
  manifest: OverlayManifest;
  settings: OverlayInstanceSettings;
  sizedFor: string | undefined;
  bounds: Bounds;
  area: Bounds;
  /** In-flow title bar height to add (TITLE_BAR_PX when showTitleBar), else 0. */
  chromePx: number;
}): { bounds: Bounds | null; sizedFor: string | undefined } {
  const { manifest, settings, sizedFor, bounds, area, chromePx } = input;
  const spec = manifest.sizeByOption;
  if (!spec) return { bounds: null, sizedFor };
  const value = settings.options[spec.key];
  if (typeof value !== "string") return { bounds: null, sizedFor };
  if (sizedFor === undefined || sizedFor === value) return { bounds: null, sizedFor: value };
  const size = spec.sizes[value];
  if (!size) return { bounds: null, sizedFor };
  const scalePct = settings.common.scalePct;
  const scaled = scaleSize(size, scalePct);
  const min = scaleSize(manifest.minSize, scalePct);
  const next = clampToWorkArea(
    { x: bounds.x, y: bounds.y, width: scaled.width, height: scaled.height + chromePx },
    area,
    min,
  );
  return { bounds: next, sizedFor: value };
}
