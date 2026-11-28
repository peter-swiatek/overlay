import { useEffect, type RefObject } from "react";
import type { FitContent } from "@overlay/overlays/contract";
import type { Size } from "../../shared/types";
import { MEASURE_INTERVAL_MS, TITLE_BAR_HEIGHT_PX } from "./contentMin";

/** Changes smaller than this (px, on both edges) are not reported: no 1 px back-and-forth. */
export const MIN_FIT_DELTA_PX = 1;

/** True when `next` differs from the last reported natural size by at least 1 px on an edge. */
export function fitChanged(last: Size | null, next: Size): boolean {
  if (last === null) return true;
  return (
    Math.abs(next.width - last.width) >= MIN_FIT_DELTA_PX ||
    Math.abs(next.height - last.height) >= MIN_FIT_DELTA_PX
  );
}

/**
 * Natural size of `el`'s content (visual CSS px, zoom included). The height is the content's own
 * height (`min-content`, so nothing stretched to the window counts) at the current width, or at
 * the max-content width for "both". The width is that max-content width for "both", else the
 * current width. Neither depends on the window height, so a resize never changes the result.
 */
export function measureNatural(el: HTMLElement, axis: Exclude<FitContent, "none">): Size {
  const { width, height } = el.style;
  if (axis === "both") el.style.width = "max-content";
  el.style.height = "min-content";
  const rect = el.getBoundingClientRect();
  el.style.width = width;
  el.style.height = height;
  return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
}

/** The window size for a natural content size: the in-flow title bar adds its height. */
export function fitWindowSize(natural: Size, titleBarInFlow: boolean): Size {
  return titleBarInFlow ? { ...natural, height: natural.height + TITLE_BAR_HEIGHT_PX } : natural;
}

/**
 * Reports the natural size of `ref`'s content to main whenever it changes (checked every 250 ms,
 * like the content minimum), so main can fit the window's content-driven edges to it. Nothing is
 * measured for "none" (the user sizes the window) or while the overlay shows a notice instead of
 * its content (the caller passes "none" then).
 */
export function useReportContentFit(
  ref: RefObject<HTMLElement | null>,
  axis: FitContent,
  titleBarInFlow: boolean,
): void {
  useEffect(() => {
    if (axis === "none") return;
    let last: Size | null = null;
    const check = (): void => {
      const el = ref.current;
      if (!el) return;
      const size = fitWindowSize(measureNatural(el, axis), titleBarInFlow);
      if (size.width <= 0 || size.height <= 0 || !fitChanged(last, size)) return;
      last = size;
      window.overlayApi.reportContentFitSize(size);
    };
    check();
    const timer = window.setInterval(check, MEASURE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ref, axis, titleBarInFlow]);
}
