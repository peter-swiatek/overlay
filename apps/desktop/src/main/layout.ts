import type { Bounds, OverlayId, Size } from "../shared/types";

export interface OverlayDefinition {
  id: OverlayId;
  title: string;
  defaultBounds: Bounds;
  minSize: Size;
}

export const OVERLAY_DEFINITIONS: readonly OverlayDefinition[] = [
  {
    id: "relative",
    title: "Demo Relative",
    defaultBounds: { x: 60, y: 60, width: 360, height: 260 },
    minSize: { width: 240, height: 180 },
  },
  {
    id: "inputs",
    title: "Demo Inputs",
    defaultBounds: { x: 60, y: 360, width: 360, height: 160 },
    minSize: { width: 200, height: 120 },
  },
];

export type Layout = Record<OverlayId, Bounds>;

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

function parseBounds(value: unknown, def: OverlayDefinition): Bounds | undefined {
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
  const size = clampSize({ width: v["width"], height: v["height"] }, def.minSize);
  return { x: Math.round(v["x"]), y: Math.round(v["y"]), ...size };
}

/** Builds a complete layout from untrusted stored data, falling back to defaults per overlay. */
export function parseLayout(raw: unknown): Layout {
  const stored = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const layout = {} as Layout;
  for (const def of OVERLAY_DEFINITIONS) {
    layout[def.id] = parseBounds(stored[def.id], def) ?? { ...def.defaultBounds };
  }
  return layout;
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
