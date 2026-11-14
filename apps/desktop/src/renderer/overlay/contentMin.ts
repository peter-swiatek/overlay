import { useEffect, type RefObject } from "react";
import type { Size } from "../../shared/types";

/** Height (px) of the in-flow title bar; it is chrome, outside the zoom wrapper. */
export const TITLE_BAR_HEIGHT_PX = 20;
/** Longest wait between two content-size measurements. */
export const MEASURE_INTERVAL_MS = 250;
/** Changes smaller than this (px, on both edges) are not worth an IPC message. */
export const MIN_REPORT_DELTA_PX = 2;

/** True when `next` differs from the last reported size by at least the delta on an edge. */
export function shouldReport(last: Size | null, next: Size): boolean {
  if (last === null) return true;
  return (
    Math.abs(next.width - last.width) >= MIN_REPORT_DELTA_PX ||
    Math.abs(next.height - last.height) >= MIN_REPORT_DELTA_PX
  );
}

/**
 * Smallest size (visual CSS px, zoom included) `el` needs: the width laid out at `min-content`,
 * the height at `min-content` for the current width. Tables size to the sum of their column floors; with `width` only,
 * the height is reported as 0 because tables may drop rows.
 */
export function measureMinContent(el: HTMLElement, includeHeight: boolean): Size {
  const { width, height } = el.style;
  el.style.width = "min-content";
  el.style.height = "";
  const minWidth = el.getBoundingClientRect().width;
  // The height is measured at the window's current width: at min-content width text wraps and
  // the content reads taller than it ever is at the size the user sees.
  el.style.width = width;
  let minHeight = 0;
  if (includeHeight) {
    el.style.height = "min-content";
    minHeight = el.getBoundingClientRect().height;
  }
  el.style.height = height;
  return { width: Math.ceil(minWidth), height: includeHeight ? Math.ceil(minHeight) : 0 };
}

/**
 * Adds the in-flow title bar to a measured content minimum. A table reports no height (0 means
 * "none"), so only a measured height grows.
 */
export function withTitleBar(size: Size, inFlow: boolean, includeHeight: boolean): Size {
  if (!inFlow || !includeHeight) return size;
  return { width: size.width, height: size.height + TITLE_BAR_HEIGHT_PX };
}

/**
 * Reports the minimum size of `ref`'s content to main whenever it changes, checked every
 * 250 ms (cheap: a small DOM and two forced layouts). Window DIPs equal CSS px here (the page zoom stays at 1).
 * With `enabled` false nothing is measured or reported (table overlays: main derives their width
 * minimum from the column fit instead).
 */
export function useReportContentMin(
  ref: RefObject<HTMLElement | null>,
  includeHeight: boolean,
  titleBarInFlow = false,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    let last: Size | null = null;
    const check = (): void => {
      const el = ref.current;
      if (!el) return;
      const size = withTitleBar(
        measureMinContent(el, includeHeight),
        titleBarInFlow,
        includeHeight,
      );
      if (!shouldReport(last, size)) return;
      last = size;
      window.overlayApi.reportContentMinSize(size);
    };
    check();
    const timer = window.setInterval(check, MEASURE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ref, includeHeight, titleBarInFlow, enabled]);
}
