import type { FitContent, OverlayManifest, SettingValue } from "@overlay/overlays/contract";
import { fitContentOf } from "@overlay/overlays/fit-content";
import type { Bounds, Size } from "../shared/types";
import { effectiveMinSize } from "./layout";

/** Size changes under this (DIPs, on both edges) leave the window alone. */
export const FIT_THRESHOLD_PX = 1;

/** Smallest window edge a fitted axis may get (the content decides, not the manifest minimum). */
export const FIT_MIN_EDGE_PX = 20;

/** The overlay's content-driven edges with these options (see `fitContentOf`); none without options. */
export function fitAxisOf(
  manifest: OverlayManifest,
  options: Readonly<Record<string, SettingValue>> | undefined,
): FitContent {
  return options === undefined ? "none" : fitContentOf(manifest, options);
}

export const fitsHeight = (axis: FitContent): boolean => axis === "height" || axis === "both";
export const fitsWidth = (axis: FitContent): boolean => axis === "both";

/**
 * The window minimum for an overlay: as `effectiveMinSize`, except that on an edge the content
 * drives the manifest minimum gives way to a small floor, so the window can shrink to content
 * that is smaller than the size the overlay was designed at (sections switched off).
 */
export function fitMinSize(
  manifestMin: Size,
  scalePct: number,
  contentMin: Size,
  tableMinWidth: number,
  axis: FitContent,
): Size {
  const floor = Math.ceil((FIT_MIN_EDGE_PX * 100) / scalePct);
  const base: Size = {
    width: fitsWidth(axis) ? Math.min(manifestMin.width, floor) : manifestMin.width,
    height: fitsHeight(axis) ? Math.min(manifestMin.height, floor) : manifestMin.height,
  };
  return effectiveMinSize(base, scalePct, contentMin, tableMinWidth);
}

/**
 * New window bounds that fit the content's natural size on the overlay's content-driven edges,
 * or null when nothing changes by 1 DIP or more. The top-left stays where it is unless a changed
 * edge would run past the work area: then the window moves up/left just enough, and an edge
 * larger than the work area itself is cut to it. Edges the content does not drive keep their size.
 */
export function planContentFit(input: {
  axis: FitContent;
  bounds: Bounds;
  /** The content's natural size in window DIPs (title bar included). */
  natural: Size;
  /** The window minimum (see `fitMinSize`). */
  min: Size;
  area: Bounds;
}): Bounds | null {
  const { axis, bounds, natural, min, area } = input;
  if (axis === "none") return null;
  const wantW = fitsWidth(axis) && natural.width > 0 ? natural.width : bounds.width;
  const wantH = fitsHeight(axis) && natural.height > 0 ? natural.height : bounds.height;
  const width = Math.min(Math.max(wantW, min.width), Math.max(area.width, min.width));
  const height = Math.min(Math.max(wantH, min.height), Math.max(area.height, min.height));
  if (
    Math.abs(width - bounds.width) < FIT_THRESHOLD_PX &&
    Math.abs(height - bounds.height) < FIT_THRESHOLD_PX
  ) {
    return null;
  }
  const clampX = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
  const clampY = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
  const x = width === bounds.width ? bounds.x : clampX;
  const y = height === bounds.height ? bounds.y : clampY;
  return { x, y, width, height };
}

/** A grip drag on a fitted overlay: the content-driven edges ignore it. */
export function gripDelta(axis: FitContent, dx: number, dy: number): { dx: number; dy: number } {
  return { dx: fitsWidth(axis) ? 0 : dx, dy: fitsHeight(axis) ? 0 : dy };
}
