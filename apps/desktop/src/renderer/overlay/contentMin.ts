import { useEffect, type RefObject } from "react";
import type { Size } from "../../shared/types";

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
 * Smallest size (visual CSS px, zoom included) `el` needs: lays it out at `min-content` for a
 * moment and reads its box. Tables size to the sum of their column floors; with `width` only,
 * the height is reported as 0 because tables may drop rows.
 */
export function measureMinContent(el: HTMLElement, includeHeight: boolean): Size {
  const { width, height } = el.style;
  el.style.width = "min-content";
  el.style.height = includeHeight ? "min-content" : "";
  const rect = el.getBoundingClientRect();
  el.style.width = width;
  el.style.height = height;
  return { width: Math.ceil(rect.width), height: includeHeight ? Math.ceil(rect.height) : 0 };
}

/**
 * Reports the minimum size of `ref`'s content to main whenever it changes, checked every
 * 250 ms (cheap: a small DOM and two forced layouts). Window DIPs equal CSS px here (the page zoom stays at 1).
 */
export function useReportContentMin(
  ref: RefObject<HTMLElement | null>,
  includeHeight: boolean,
): void {
  useEffect(() => {
    let last: Size | null = null;
    const check = (): void => {
      const el = ref.current;
      if (!el) return;
      const size = measureMinContent(el, includeHeight);
      if (!shouldReport(last, size)) return;
      last = size;
      window.overlayApi.reportContentMinSize(size);
    };
    check();
    const timer = window.setInterval(check, MEASURE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ref, includeHeight]);
}
