import type { OverlayRuntime } from "@overlay/overlays";
import type { OverlayManifest } from "@overlay/overlays/contract";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import type { DisplayPrefs } from "@overlay/ui/types";
import type { OverlaySize } from "../../../shared/types";

/** The preview never runs faster than this (plan section 6: preview cost). */
export const PREVIEW_HZ = 10;

/** Pixels per `ch` assumed before the first measurement. */
export const FALLBACK_CH_PX = 7;

export interface Box {
  width: number;
  height: number;
}

/** The overlay's real window size and scale, or the manifest default before it is known. */
export function previewSize(
  size: OverlaySize | null,
  manifest: Pick<OverlayManifest, "defaultSize">,
): OverlaySize {
  if (size !== null && size.width > 0 && size.height > 0) return size;
  return { ...manifest.defaultSize, scalePct: size?.scalePct ?? 100 };
}

/**
 * Scale that fits a `content` box into the `available` box. Never enlarges (the preview shows
 * the real size when there is room) and never returns 0 or NaN.
 */
export function fitScale(available: Box, content: Box): number {
  if (!(content.width > 0) || !(content.height > 0)) return 1;
  if (!(available.width > 0) || !(available.height > 0)) return 1;
  const fit = Math.min(available.width / content.width, available.height / content.height, 1);
  return Math.max(fit, 0.05);
}

/**
 * The settings window may be shown with CSS `zoom` (UI scale). The ratio of an element's drawn
 * width to its layout width is that zoom; the preview divides it out so sizes stay real.
 */
export function zoomRatio(drawnWidth: number, layoutWidth: number): number {
  if (!(drawnWidth > 0) || !(layoutWidth > 0)) return 1;
  const ratio = drawnWidth / layoutWidth;
  return ratio > 0.25 && ratio < 8 ? ratio : 1;
}

export function captionText(size: Pick<OverlaySize, "width" | "height">): string {
  return `Preview with demo data. ${Math.round(size.width)} × ${Math.round(size.height)} on screen.`;
}

/** True when the preview should not spend CPU. */
export function previewPaused(state: {
  visibility: "visible" | "hidden" | "prerender";
  minimised: boolean;
}): boolean {
  return state.visibility !== "visible" || state.minimised;
}

/**
 * Converts a drawn length to the overlay's own CSS px (the space inside its scale zoom), so the
 * floor percentage is the same at every scale: divides out the fit transform and the scale.
 */
export function toOverlayPx(drawnPx: number, fit: number, scalePct: number): number {
  const divisor = fit * (scalePct / 100);
  return divisor > 0 && drawnPx > 0 ? drawnPx / divisor : 0;
}

export interface MeasureInput {
  /** Drawn (screen) widths of the table and of the 10ch probe; 0 when absent. */
  drawnTableWidth: number;
  drawnProbeWidth: number;
  fit: number;
  scalePct: number;
  /** The theme's `--ov-cell-pad-x` as read from the probe, e.g. "5px"; absent when unset. */
  cellPadValue?: string;
}

/** The numbers reported through `onMeasure`, rounded so tiny jitter does not re-report. */
export function computeMeasure(input: MeasureInput): {
  tableWidthPx: number;
  chPx: number;
  cellPadPx?: number;
} {
  const table = toOverlayPx(input.drawnTableWidth, input.fit, input.scalePct);
  const ch = toOverlayPx(input.drawnProbeWidth / 10, input.fit, input.scalePct);
  const pad = parseFloat(input.cellPadValue ?? "");
  return {
    tableWidthPx: Math.round(table * 10) / 10,
    chPx: ch > 0 ? Math.round(ch * 100) / 100 : FALLBACK_CH_PX,
    ...(pad > 0 ? { cellPadPx: pad } : {}),
  };
}

/** A frame the overlays can draw: the feed's when it is live, else the first-paint fallback. */
export function usableFrame(
  frame: TelemetryFrame | null,
  fallback: TelemetryFrame,
): TelemetryFrame {
  return frame !== null && frame.status === "live" ? frame : fallback;
}

type Listener = () => void;

/** Holds the newest demo frame for the preview's `useTelemetry`. */
export interface FrameStore {
  latest(): TelemetryFrame;
  set(frame: TelemetryFrame): void;
  subscribe(listener: Listener): () => void;
}

export function createFrameStore(initial: TelemetryFrame): FrameStore {
  let frame = initial;
  const listeners = new Set<Listener>();
  return {
    latest: () => frame,
    set(next) {
      frame = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface RuntimeInputs {
  prefs: DisplayPrefs;
  livePositions: boolean;
  reduceVisualEffects: boolean;
  combinedLicencePill: boolean;
}

/** The runtime the real overlay components read: demo telemetry, never editing. */
export function createPreviewRuntime(
  useTelemetry: OverlayRuntime["useTelemetry"],
  inputs: RuntimeInputs,
): OverlayRuntime {
  return { useTelemetry, ...inputs, editing: false };
}

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface DriverOptions {
  next(dtS: number): TelemetryFrame;
  onFrame(frame: TelemetryFrame): void;
  timers: Timers;
  hz?: number;
}

/**
 * Builds a value once and hands the same one out afterwards. A failed build is not remembered,
 * so the next call tries again. The demo feed's warm-up takes 50 to 150 ms, so the previews
 * (one per overlay selection) share one feed.
 */
export function createLazy<T>(create: () => T): () => T {
  let value: { v: T } | null = null;
  return () => {
    if (value === null) value = { v: create() };
    return value.v;
  };
}

/**
 * Builds the feed and starts the driver. When the feed cannot be built nothing is started and
 * null comes back, so a failed preview never keeps a timer running.
 */
export function bootFeed<F>(
  create: () => F,
  driver: { start(): void },
  paused: boolean,
  onError: (err: unknown) => void,
): F | null {
  let feed: F;
  try {
    feed = create();
  } catch (err) {
    onError(err);
    return null;
  }
  if (!paused) driver.start();
  return feed;
}

/** Steps the demo feed at a fixed rate; `stop()` is what pausing does. */
export function createFeedDriver(options: DriverOptions): { start(): void; stop(): void } {
  const hz = options.hz ?? PREVIEW_HZ;
  let handle: unknown = null;
  return {
    start() {
      if (handle !== null) return;
      handle = options.timers.setInterval(
        () => options.onFrame(options.next(1 / hz)),
        Math.round(1000 / hz),
      );
    },
    stop() {
      if (handle === null) return;
      options.timers.clearInterval(handle);
      handle = null;
    },
  };
}
