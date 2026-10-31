import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import type { Bounds, Size } from "../shared/types";

/** Bounds plus the scale (percent) they were sized for. M1 entries have no scale and mean 100. */
export interface StoredBounds extends Bounds {
  scalePct: number;
}

/** Bounds of every overlay the user has placed, keyed by manifest id. */
export type Layout = Record<string, StoredBounds>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampSize(size: Size, min: Size): Size {
  return { width: Math.max(min.width, size.width), height: Math.max(min.height, size.height) };
}

/** Applies a size delta from the resize grip, never going below the minimum size. */
export function resizeBounds(bounds: Bounds, dx: number, dy: number, min: Size): Bounds {
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) return bounds;
  const size = clampSize({ width: bounds.width + dx, height: bounds.height + dy }, min);
  return { x: bounds.x, y: bounds.y, ...size };
}

/** Smallest window edge accepted from a stored layout (the manifest minimum is applied later). */
const MIN_STORED_EDGE = 20;

function parseBounds(value: unknown): StoredBounds | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (
    !isFiniteNumber(v["x"]) ||
    !isFiniteNumber(v["y"]) ||
    !isFiniteNumber(v["width"]) ||
    !isFiniteNumber(v["height"])
  ) {
    return undefined;
  }
  const size = clampSize(
    { width: v["width"], height: v["height"] },
    { width: MIN_STORED_EDGE, height: MIN_STORED_EDGE },
  );
  const pct = v["scalePct"];
  const scalePct = isFiniteNumber(pct) && pct > 0 ? pct : 100;
  return { x: Math.round(v["x"]), y: Math.round(v["y"]), ...size, scalePct };
}

/** M1 stored the demo inputs window as "inputs"; it is "demo-inputs" now. */
const LEGACY_IDS: Readonly<Record<string, string>> = { "demo-inputs": "inputs" };

/**
 * Reads stored bounds for the known overlays only. Invalid entries and unknown ids are dropped
 * (the overlay then gets default bounds), and M1's "inputs" entry migrates to "demo-inputs".
 */
export function parseLayout(raw: unknown, manifests: readonly OverlayManifest[]): Layout {
  const stored = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const layout: Layout = {};
  for (const manifest of manifests) {
    const legacyId = LEGACY_IDS[manifest.id];
    const bounds =
      parseBounds(stored[manifest.id]) ??
      (legacyId === undefined ? undefined : parseBounds(stored[legacyId]));
    if (bounds) layout[manifest.id] = bounds;
  }
  return layout;
}

/** A size scaled by a percentage, rounded to whole pixels. */
export function scaleSize(size: Size, scalePct: number): Size {
  return {
    width: Math.round((size.width * scalePct) / 100),
    height: Math.round((size.height * scalePct) / 100),
  };
}

/** First-use bounds: the primary work area's origin plus the manifest offset, size scaled. */
export function defaultBounds(
  manifest: OverlayManifest,
  scalePct: number,
  primaryWorkArea: Bounds,
): Bounds {
  return {
    x: primaryWorkArea.x + manifest.defaultPosition.x,
    y: primaryWorkArea.y + manifest.defaultPosition.y,
    ...scaleSize(manifest.defaultSize, scalePct),
  };
}

/** Stored bounds while still on a screen, otherwise the defaults; never below the scaled minimum. */
export function initialBounds(
  manifest: OverlayManifest,
  stored: Bounds | undefined,
  scalePct: number,
  workAreas: readonly Bounds[],
  primaryWorkArea: Bounds,
): Bounds {
  const min = scaleSize(manifest.minSize, scalePct);
  const bounds =
    stored && isReachable(stored, workAreas)
      ? { ...stored, ...clampSize(stored, min) }
      : defaultBounds(manifest, scalePct, primaryWorkArea);
  const area = workAreas.find((a) => isReachable(bounds, [a])) ?? primaryWorkArea;
  return clampToWorkArea(bounds, area, min);
}

/**
 * Resizes by the ratio of two scales keeping the top-left corner, never below the minimum size
 * at the new scale. `minSize` is the manifest's size at 100 %.
 */
export function scaleBounds(bounds: Bounds, fromPct: number, toPct: number, minSize: Size): Bounds {
  if (!(fromPct > 0) || !(toPct > 0)) return bounds;
  const size = clampSize(scaleSize(bounds, (toPct / fromPct) * 100), scaleSize(minSize, toPct));
  return { x: bounds.x, y: bounds.y, ...size };
}

export interface WindowPlan {
  open: string[];
  close: string[];
}

/** Which windows to create (developer-only manifests only while developer tools are on) and which to close so the open set matches the enabled overlays. */
export function planWindowChanges(
  manifests: readonly OverlayManifest[],
  settingsById: Readonly<Record<string, OverlayInstanceSettings | undefined>>,
  openIds: Iterable<string>,
  developerEnabled = true,
): WindowPlan {
  const open = new Set(openIds);
  const wanted = new Set(
    manifests
      .filter((m) => settingsById[m.id]?.enabled === true && (developerEnabled || m.dev !== true))
      .map((m) => m.id),
  );
  return {
    open: manifests.map((m) => m.id).filter((id) => wanted.has(id) && !open.has(id)),
    close: [...open].filter((id) => !wanted.has(id)),
  };
}

/** Shrinks bounds so the window does not extend past the work area (never below the minimum). */
export function clampToWorkArea(bounds: Bounds, area: Bounds, min: Size): Bounds {
  const maxWidth = Math.max(min.width, area.x + area.width - bounds.x);
  const maxHeight = Math.max(min.height, area.y + area.height - bounds.y);
  return {
    ...bounds,
    width: Math.min(bounds.width, maxWidth),
    height: Math.min(bounds.height, maxHeight),
  };
}

/** True when at least a 40x40 corner of the window lies inside one of the work areas. */
export function isReachable(bounds: Bounds, workAreas: readonly Bounds[]): boolean {
  return workAreas.some((area) => {
    const w = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const h = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return w >= 40 && h >= 40;
  });
}
