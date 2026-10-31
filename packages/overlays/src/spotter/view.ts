import type { TelemetryFrame } from "@overlay/sim-core/types";

export interface SpotterSide {
  /** 0 = block at the top of the bar (the car almost past us) … 1 = at the bottom (its nose at our tail); null = hidden. */
  position: number | null;
  /** Two cars on that side (twoLeft / twoRight): the block is drawn double. */
  double: boolean;
}
export interface SpotterView {
  left: SpotterSide;
  right: SpotterSide;
}

interface Remembered {
  position: number;
  double: boolean;
  lastSeenMs: number;
}

/** Last shown side states, so a side can be held briefly after it clears. */
export interface SpotterMemory {
  left: Remembered | null;
  right: Remembered | null;
}

export function newSpotterMemory(): SpotterMemory {
  return { left: null, right: null };
}

/** A side stays shown this long after the data stops reporting a car (LMU steps at ~5 Hz). */
export const HOLD_MS = 300;

/**
 * Proximity offset (-1 = its nose at our tail, 0 = level, +1 = its tail at our nose) to a bar
 * position: +1 (car almost past) → 0 (top), 0 → 0.5 (middle), -1 → 1 (bottom). Rounded to 0.01.
 */
export function offsetToPosition(offset: number): number {
  const p = Math.min(1, Math.max(0, (1 - offset) / 2));
  return Math.round(p * 100) / 100;
}

function side(
  mem: Remembered | null,
  offset: number | null | undefined,
  double: boolean,
  nowMs: number,
): { shown: SpotterSide; next: Remembered | null } {
  if (offset !== null && offset !== undefined && Number.isFinite(offset)) {
    const position = offsetToPosition(offset);
    return { shown: { position, double }, next: { position, double, lastSeenMs: nowMs } };
  }
  if (mem !== null && nowMs - mem.lastSeenMs <= HOLD_MS) {
    return { shown: { position: mem.position, double: mem.double }, next: mem };
  }
  return { shown: { position: null, double: false }, next: null };
}

/** Deterministic given its inputs; updates `memory` in place. */
export function spotterView(
  frame: TelemetryFrame | null,
  memory: SpotterMemory,
  nowMs: number,
): SpotterView {
  const prox = frame !== null && frame.status === "live" ? frame.derived.proximity : null;
  const call = prox?.carLeftRight;
  const l = side(memory.left, prox?.left, call === "twoLeft", nowMs);
  const r = side(memory.right, prox?.right, call === "twoRight", nowMs);
  memory.left = l.next;
  memory.right = r.next;
  return { left: l.shown, right: r.shown };
}

export const EDIT_SAMPLE: SpotterView = {
  left: { position: 0.5, double: false },
  right: { position: 0.25, double: false },
};

/** "accent" → the theme accent variable; "#rrggbb" → itself; anything else → the accent. */
export function barColourCss(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "var(--ov-accent)";
}
