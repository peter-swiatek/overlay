import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import type { Bounds, Size } from "../shared/types";

/** Bounds plus the scale (percent) they were sized for. M1 entries have no scale and mean 100. */
export interface StoredBounds extends Bounds {
  scalePct: number;
  /** Window width (DIPs, at scalePct) the column fit last set or recorded; absent before the first fit. */
  fitWidth?: number;
  /** Value of the manifest's sizeByOption option the size was last set for. */
  sizedFor?: string;
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
  const stored: StoredBounds = { x: Math.round(v["x"]), y: Math.round(v["y"]), ...size, scalePct };
  const fitWidth = v["fitWidth"];
  if (isFiniteNumber(fitWidth) && fitWidth > 0) stored.fitWidth = fitWidth;
  const sizedFor = v["sizedFor"];
  if (typeof sizedFor === "string") stored.sizedFor = sizedFor;
  return stored;
}

/** The developer demo "demo-inputs" became the Inputs overlay; its stored bounds carry over. */
const LEGACY_IDS: Readonly<Record<string, string>> = { inputs: "demo-inputs" };

/**
 * Reads stored bounds for the known overlays only. Invalid entries and unknown ids are dropped
 * (the overlay then gets default bounds), and a stored "demo-inputs" entry migrates to "inputs".
 */
export function parseLayout(raw: unknown, manifests: readonly OverlayManifest[]): Layout {
  const stored = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const layout: Layout = {};
  for (const manifest of manifests) {
    const legacyId = LEGACY_IDS[manifest.id];
    const bounds =
      parseBounds(stored[manifest.id]) ??
      (legacyId === undefined ? undefined : parseBounds(stored[legacyId]));
    if (bounds) layout[manifest.id] = migrateRetiredSize(bounds, manifest);
  }
  return layout;
}

/**
 * Default sizes a later design replaced. A window still at one of these (the user never resized
 * it) moves to the new default size, so the new layout is not squeezed into the old window.
 * `anchorBottom` keeps the bottom edge where it was when the window grows upwards.
 */
const RETIRED_DEFAULT_SIZES: Readonly<
  Record<string, readonly { size: Size; anchorBottom: boolean }[]>
> = {
  "compact-hud": [{ size: { width: 340, height: 172 }, anchorBottom: true }],
  "delta-bar": [{ size: { width: 560, height: 131 }, anchorBottom: false }],
  weather: [
    { size: { width: 240, height: 352 }, anchorBottom: false },
    { size: { width: 200, height: 352 }, anchorBottom: false },
  ],
};

function migrateRetiredSize(bounds: StoredBounds, manifest: OverlayManifest): StoredBounds {
  const retired = RETIRED_DEFAULT_SIZES[manifest.id];
  if (!retired) return bounds;
  for (const { size, anchorBottom } of retired) {
    const old = scaleSize(size, bounds.scalePct);
    if (Math.abs(bounds.width - old.width) > 1) continue;
    // The window may carry the title bar on top of the content.
    const chrome = [0, TITLE_BAR_PX].find((c) => Math.abs(bounds.height - c - old.height) <= 1);
    if (chrome === undefined) continue;
    const next = scaleSize(manifest.defaultSize, bounds.scalePct);
    const height = next.height + chrome;
    const y = anchorBottom ? bounds.y + bounds.height - height : bounds.y;
    const migrated: StoredBounds = { ...bounds, y, width: next.width, height };
    delete migrated.fitWidth;
    return migrated;
  }
  return bounds;
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
  return placeInWorkArea(
    {
      x: primaryWorkArea.x + manifest.defaultPosition.x,
      y: primaryWorkArea.y + manifest.defaultPosition.y,
      ...scaleSize(manifest.defaultSize, scalePct),
    },
    primaryWorkArea,
    scaleSize(manifest.minSize, scalePct),
  );
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
  return placeInWorkArea(bounds, area, min);
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

/** Height of the in-flow title bar (fixed px, not scaled); matches the renderer's TITLE_BAR_HEIGHT_PX. */
export const TITLE_BAR_PX = 20;

/**
 * Like {@link scaleBounds}, but keeps `chromePx` of fixed-height chrome (the title bar) out of the
 * scaling: only the content below it grows or shrinks.
 */
export function scaleBoundsWithChrome(
  bounds: Bounds,
  fromPct: number,
  toPct: number,
  minSize: Size,
  chromePx: number,
): Bounds {
  if (chromePx <= 0) return scaleBounds(bounds, fromPct, toPct, minSize);
  const content = { ...bounds, height: Math.max(0, bounds.height - chromePx) };
  const scaled = scaleBounds(content, fromPct, toPct, minSize);
  return { ...scaled, height: scaled.height + chromePx };
}

/** Scales a reported content minimum whose height includes `chromePx` of fixed chrome. */
export function scaleContentMin(size: Size, ratioPct: number, chromePx: number): Size {
  if (chromePx <= 0 || size.height <= 0) return scaleSize(size, ratioPct);
  const scaled = scaleSize(
    { width: size.width, height: Math.max(0, size.height - chromePx) },
    ratioPct,
  );
  return { width: scaled.width, height: scaled.height + chromePx };
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

/**
 * Fits bounds inside the work area: keeps the size and moves the window left/up when it overhangs
 * the right/bottom edge, and only shrinks (never below the minimum) when the size itself exceeds
 * the area. Positions left of or above the area are moved in too.
 */
export function placeInWorkArea(bounds: Bounds, area: Bounds, min: Size): Bounds {
  const width = Math.min(bounds.width, Math.max(min.width, area.width));
  const height = Math.min(bounds.height, Math.max(min.height, area.height));
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
  return { ...bounds, x, y, width, height };
}

/** True when at least a 40x40 corner of the window lies inside one of the work areas. */
export function isReachable(bounds: Bounds, workAreas: readonly Bounds[]): boolean {
  return workAreas.some((area) => {
    const w = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const h = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return w >= 40 && h >= 40;
  });
}

/** Largest content minimum accepted from a renderer (window DIPs). */
export const MAX_CONTENT_MIN = 4000;

/**
 * Validates a `{ width, height }` content minimum from an overlay renderer. Edges are rounded up
 * and clamped to 0..4000 (0 means "no minimum on this axis"); anything else gives undefined.
 */
export function parseContentMin(value: unknown): Size | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const w = v["width"];
  const h = v["height"];
  if (!isFiniteNumber(w) || !isFiniteNumber(h)) return undefined;
  const edge = (n: number): number => Math.min(MAX_CONTENT_MIN, Math.max(0, Math.ceil(n)));
  return { width: edge(w), height: edge(h) };
}

/**
 * The window minimum: the larger of the scaled manifest minimum and what the content reported.
 * `tableMinWidth` (scaled DIPs, from the column fit) is folded into the width.
 */
export function effectiveMinSize(
  manifestMin: Size,
  scalePct: number,
  contentMin: Size,
  tableMinWidth = 0,
): Size {
  return clampSize(scaleSize(manifestMin, scalePct), {
    width: Math.max(contentMin.width, tableMinWidth),
    height: contentMin.height,
  });
}

/**
 * Grows bounds to at least `min`, keeping the top-left corner, then moves them back up/left
 * if that pushed them past the work area (never past the area's own top-left).
 */
export function growToMin(bounds: Bounds, min: Size, area: Bounds): Bounds {
  const size = clampSize(bounds, min);
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - size.width));
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - size.height));
  return { x, y, ...size };
}
