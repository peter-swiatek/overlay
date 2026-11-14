import { useEffect, useRef, type RefObject } from "react";
import type { PageRect } from "../contract";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { webviewOptions } from "./options";
import "./webview.css";

/** Edit-mode text while no address is set. */
export const NO_URL_TEXT = "Set a web page URL in settings";
/** Settings-preview text: the page itself only ever loads in the overlay window. */
export const PREVIEW_TEXT = "The page shows in the overlay on screen";
/** How often the page area is re-measured besides resizes (it can move without resizing). */
export const RECT_POLL_MS = 500;

/** Whole CSS px of an element's box in the window. */
export function pageRectOf(box: Pick<DOMRect, "left" | "top" | "width" | "height">): PageRect {
  return {
    x: Math.round(box.left),
    y: Math.round(box.top),
    width: Math.max(0, Math.round(box.width)),
    height: Math.max(0, Math.round(box.height)),
  };
}

export function sameRect(a: PageRect | null, b: PageRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Reports where `ref` is to the host whenever it moves or resizes, and null once it goes away.
 * `report` should keep its identity; a new one starts over.
 */
function useReportPageRect(
  ref: RefObject<HTMLElement | null>,
  report: ((rect: PageRect | null) => void) | undefined,
): void {
  const measureRef = useRef<() => void>(() => {});
  useEffect(() => {
    const el = ref.current;
    if (!report || !el) return undefined;
    let last: PageRect | null = null;
    const measure = (): void => {
      const next = pageRectOf(el.getBoundingClientRect());
      if (sameRect(last, next)) return;
      last = next;
      report(next);
    };
    measureRef.current = measure;
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    const timer = setInterval(measure, RECT_POLL_MS);
    return () => {
      measureRef.current = () => {};
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      clearInterval(timer);
      report(null);
    };
  }, [ref, report]);
  // A re-render may move the area (address bar shown or hidden): check again after each one.
  useEffect(() => measureRef.current());
}

function OnOff({ label, on }: { label: string; on: boolean }) {
  return (
    <span className="wv-flag">
      {label}: <b>{on ? "ON" : "OFF"}</b>
    </span>
  );
}

/**
 * A web page chosen by the user. The overlay only draws the address bar (edit mode or with the
 * title bar on) and marks out the page area: the host process loads the page in its own sandboxed
 * view and lays it over that area.
 */
export function WebviewOverlay({ settings }: OverlayProps) {
  const { editing, reportPageRect } = useOverlayRuntime();
  const o = webviewOptions(settings);
  const pageRef = useRef<HTMLDivElement>(null);
  const embedded = o.url !== null && reportPageRect !== undefined;
  useReportPageRect(pageRef, embedded ? reportPageRect : undefined);

  // Nothing at all while driving without a page.
  if (o.url === null && !editing) return <></>;

  const showBar = editing || settings.common.showTitleBar;
  return (
    <div className="wv" data-editing={editing || undefined}>
      {showBar && (
        <div className="wv-bar">
          <span className="wv-bar-label">URL</span>
          <span className="wv-bar-url" title={o.urlText}>
            {o.url ?? "Not set"}
          </span>
          {o.zoomPct !== 100 && <span className="wv-badge">{`${o.zoomPct}%`}</span>}
        </div>
      )}
      <div className="wv-page" ref={pageRef} data-empty={o.url === null || undefined}>
        {o.url === null && <div className="wv-placeholder">{NO_URL_TEXT}</div>}
        {o.url !== null && !embedded && <div className="wv-placeholder">{PREVIEW_TEXT}</div>}
      </div>
      {editing && (
        <div className="wv-strip">
          <OnOff label="Transparent background" on={o.transparent} />
          <OnOff label="Hide scrollbars" on={o.hideScrollbars} />
        </div>
      )}
    </div>
  );
}
