import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { moduleById, type OverlayRuntime, type TelemetrySelector } from "@overlay/overlays";
import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import { createDemoFeed, type DemoFeed } from "@overlay/sim-core/demo";
import { GRAPHITE } from "@overlay/theme";
import type { Theme } from "@overlay/theme/types";
import { displayPrefsOf } from "../../../shared/app-settings-types";
import type { OverlaySize } from "../../../shared/types";
import { structurallyEqual } from "../../telemetry/client";
import { useAppSettings } from "../../overlay/useSettings";
import { fallbackFrame } from "./fallback-frame";
import { PreviewStage } from "./PreviewStage";
import {
  captionText,
  computeMeasure,
  createFeedDriver,
  createFrameStore,
  createPreviewRuntime,
  fitScale,
  previewPaused,
  previewSize,
  usableFrame,
  zoomRatio,
  type FrameStore,
} from "./preview-runtime";

/** What the preview measures from the rendered overlay, for the column width floor. */
export interface PreviewMeasure {
  /**
   * Width of the overlay's table, and of one `ch`, in the overlay's own CSS px (inside its
   * scale zoom, undone for the fit transform and the settings window's UI scale). Both are in
   * the same space, so a ratio of the two is the same at every scale. `tableWidthPx` is 0 when
   * there is no table.
   */
  tableWidthPx: number;
  chPx: number;
}

/**
 * Props are fixed by MW-0 so MW-3 (implements) and MW-5 (mounts) can work in parallel.
 */
export interface OverlayPreviewProps {
  manifest: OverlayManifest;
  /** The overlay's current stored settings; the preview re-renders on every change. */
  settings: OverlayInstanceSettings;
  /**
   * The overlay's real on-screen size from `overlays.getSizes()`, or null before it is known
   * (then the manifest's `defaultSize` is used).
   */
  size: OverlaySize | null;
  /** Called after each render pass and on resize/font load with the latest measurements. */
  onMeasure(measure: PreviewMeasure): void;
}

/** Cap on how tall the scaled preview may get, as a share of the window height. */
const MAX_HEIGHT_SHARE = 0.6;

function useActiveTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(GRAPHITE);
  useEffect(() => {
    const api = window.overlayApi?.theme;
    if (!api) return;
    let pushed = false;
    let cancelled = false;
    api
      .getActive()
      .then((t) => {
        if (!pushed && !cancelled) setTheme(t);
      })
      .catch((err: unknown) => console.error("Preview: could not load the theme", err));
    const off = api.onChanged((t) => {
      pushed = true;
      setTheme(t);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return theme;
}

function usePaused(): boolean {
  const read = (): boolean =>
    previewPaused({
      visibility: typeof document === "undefined" ? "visible" : document.visibilityState,
      minimised: false,
    });
  const [paused, setPaused] = useState(read);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = (): void => setPaused(read());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return paused;
}

/** Steps the demo feed into the store while not paused. The feed is built after first paint. */
function useDemoFeed(store: FrameStore, paused: boolean): void {
  const feedRef = useRef<DemoFeed | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const fallback = useMemo(() => fallbackFrame(), []);
  const driver = useMemo(
    () =>
      createFeedDriver({
        next: (dt) => feedRef.current?.next(dt) ?? fallback,
        onFrame: (frame) => store.set(usableFrame(frame, fallback)),
        timers: {
          setInterval: (fn, ms) => window.setInterval(fn, ms),
          clearInterval: (h) => window.clearInterval(h as number),
        },
      }),
    [store, fallback],
  );
  useEffect(() => {
    // The warm-up simulates laps synchronously; do it after the fallback has painted.
    const timer = window.setTimeout(() => {
      try {
        feedRef.current = createDemoFeed();
      } catch (err) {
        console.error("Preview: demo feed failed; keeping the fallback frame", err);
      }
      if (!pausedRef.current) driver.start();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      driver.stop();
    };
  }, [driver]);
  useEffect(() => {
    if (feedRef.current === null) return;
    if (paused) driver.stop();
    else driver.start();
  }, [paused, driver]);
}

/** Live preview of one overlay on demo data. */
export function OverlayPreview({ manifest, settings, size, onMeasure }: OverlayPreviewProps) {
  const module = moduleById(manifest.id);
  const app = useAppSettings();
  const theme = useActiveTheme();
  const paused = usePaused();
  const store = useMemo(() => createFrameStore(fallbackFrame()), []);
  useDemoFeed(store, paused);

  const useTelemetry = useMemo<OverlayRuntime["useTelemetry"]>(
    () =>
      function usePreviewTelemetry<T>(selector: TelemetrySelector<T>): T {
        const selectorRef = useRef(selector);
        selectorRef.current = selector;
        const [value, setValue] = useState<T>(() => selector(store.latest(), false));
        const valueRef = useRef(value);
        useEffect(() => {
          const sync = (): void => {
            const next = selectorRef.current(store.latest(), false);
            if (structurallyEqual(valueRef.current, next)) return;
            valueRef.current = next;
            setValue(next);
          };
          sync();
          return store.subscribe(sync);
        }, []);
        return value;
      },
    [store],
  );
  const runtime = useMemo(
    () =>
      createPreviewRuntime(useTelemetry, {
        prefs: app
          ? displayPrefsOf(app)
          : { units: "metric", speedInMph: false, timeFormat: "24h" },
        livePositions: app?.performance.livePositions ?? true,
        reduceVisualEffects: app?.performance.reduceVisualEffects ?? false,
        combinedLicencePill: app?.appearance.combinedLicencePill ?? false,
      }),
    [useTelemetry, app],
  );

  const real = previewSize(size, manifest);
  const paneRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ fit: 1, shellZoom: 1 });
  const lastMeasure = useRef<PreviewMeasure | null>(null);
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;
  const scalePct = settings.common.scalePct;

  // Fit the real window into the pane and undo the settings window's UI zoom.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const update = (): void => {
      const style = getComputedStyle(pane);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const shellZoom = zoomRatio(pane.getBoundingClientRect().width, pane.offsetWidth);
      // Local px of the pane times the zoom are the screen px the overlay is drawn in.
      const availW = Math.max(0, pane.clientWidth - padX) * shellZoom;
      const availH = window.innerHeight * MAX_HEIGHT_SHARE;
      const fit = fitScale({ width: availW, height: availH }, real);
      setLayout((prev) =>
        prev.fit === fit && prev.shellZoom === shellZoom ? prev : { fit, shellZoom },
      );
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(pane);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [real.width, real.height]);

  // Report the table width and ch after each render, on resize and when fonts load.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = (): void => {
      const table = stage.querySelector(".ov-table");
      const probe = stage.querySelector(".pv-ch-probe");
      const next: PreviewMeasure = computeMeasure({
        drawnTableWidth: table ? table.getBoundingClientRect().width : 0,
        drawnProbeWidth: probe ? probe.getBoundingClientRect().width : 0,
        fit: layout.fit,
        scalePct,
      });
      const prev = lastMeasure.current;
      if (prev && prev.tableWidthPx === next.tableWidthPx && prev.chPx === next.chPx) return;
      lastMeasure.current = next;
      onMeasureRef.current(next);
    };
    measure();
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(stage);
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  });

  if (!module) return null;
  return (
    <div className="pv-root">
      <div className="pv-pane" ref={paneRef}>
        <PreviewStage
          ref={stageRef}
          module={module}
          settings={settings}
          size={real}
          fit={layout.fit}
          shellZoom={layout.shellZoom}
          runtime={runtime}
          theme={theme}
        />
      </div>
      <p className="pv-caption">{captionText(real)}</p>
    </div>
  );
}
