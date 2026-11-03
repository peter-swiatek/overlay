import { useEffect, type RefObject } from "react";
import type { TableMetrics } from "@overlay/ui/fit";

/** Longest wait between two table font measurements. */
export const METRICS_INTERVAL_MS = 500;
/** Changes smaller than this (px) are not worth an IPC message. */
export const METRICS_MIN_DELTA_PX = 0.01;
/** The probe span is this many `ch` wide, so one `ch` is its width divided by this. */
export const PROBE_CH_COUNT = 100;
const DEFAULT_CELL_PAD_PX = 7;

/**
 * Turns the probe span's width (px, 100 `ch` wide) and the computed `--ov-cell-pad-x` value into
 * metrics. Null for a 0 or non-finite width (the probe is not laid out yet). An unreadable
 * padding falls back to 7 px.
 */
export function readMetrics(spanWidthPx: number, padValue: string): TableMetrics | null {
  if (!Number.isFinite(spanWidthPx) || spanWidthPx <= 0) return null;
  const pad = parseFloat(padValue);
  return {
    chPx: spanWidthPx / PROBE_CH_COUNT,
    cellPadPx: Number.isFinite(pad) && pad >= 0 ? pad : DEFAULT_CELL_PAD_PX,
  };
}

/** True when either value moved by at least 0.01 px since the last report (or none was sent). */
export function metricsChanged(prev: TableMetrics | null, next: TableMetrics): boolean {
  if (prev === null) return true;
  return (
    Math.abs(prev.chPx - next.chPx) >= METRICS_MIN_DELTA_PX ||
    Math.abs(prev.cellPadPx - next.cellPadPx) >= METRICS_MIN_DELTA_PX
  );
}

/**
 * Measures the table font from the hidden probe at `ref` (on mount, every 500 ms and when fonts
 * finish loading) and reports it to main whenever it changes. The probe sits outside the zoom
 * wrapper, so the values are at zoom 1.
 */
export function useReportTableMetrics(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let last: TableMetrics | null = null;
    const check = (): void => {
      const probe = ref.current;
      const span = probe?.querySelector<HTMLElement>(".ov-metrics-ch");
      if (!probe || !span) return;
      const pad = getComputedStyle(probe).getPropertyValue("--ov-cell-pad-x");
      const metrics = readMetrics(span.offsetWidth, pad);
      if (!metrics || !metricsChanged(last, metrics)) return;
      last = metrics;
      window.overlayApi.reportTableMetrics(metrics);
    };
    check();
    const timer = window.setInterval(check, METRICS_INTERVAL_MS);
    void document.fonts?.ready.then(check);
    return () => window.clearInterval(timer);
  }, [ref]);
}
