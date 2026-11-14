import { useEffect, useMemo, useRef } from "react";
import {
  instanceTitle,
  OverlayRuntimeContext,
  type OverlayModule,
  type OverlayRuntime,
} from "@overlay/overlays";
import type { TelemetrySelector } from "@overlay/overlays";
import { displayPrefsOf, type AppSettings } from "../../shared/app-settings-types";
import { useTelemetry } from "../telemetry/useTelemetry";
import { useTrackOutline } from "../telemetry/useTrackOutline";
import { useApplyTheme } from "../theme/useApplyTheme";
import { OverlayContent } from "./OverlayContent";
import { cappedRateHz, hostView } from "./visibility";
import { useReportTableMetrics } from "./tableMetrics";
import { useAppSettings, useEditMode, useOverlaySettings } from "./useSettings";

const HOST_VIEW_HZ = 5;

/** One function for the window's lifetime, so the Webview overlay keeps its report effect. */
const reportPageRect: NonNullable<OverlayRuntime["reportPageRect"]> = (rect) =>
  window.overlayApi.reportWebPageRect(rect);

/** A `useTelemetry` for overlay components that never runs faster than `maxHz`. */
function cappedTelemetry(maxHz: number, performanceHz: number): OverlayRuntime["useTelemetry"] {
  return function useCappedTelemetry<T>(selector: TelemetrySelector<T>, rateHz: number): T {
    return useTelemetry(selector, cappedRateHz(rateHz, maxHz, performanceHz));
  };
}

function runtimeOf(app: AppSettings, module: OverlayModule, editing: boolean): OverlayRuntime {
  return {
    useTelemetry: cappedTelemetry(module.manifest.rateHz, app.performance.telemetryRateHz),
    prefs: displayPrefsOf(app),
    livePositions: app.performance.livePositions,
    reduceVisualEffects: app.performance.reduceVisualEffects,
    combinedLicencePill: app.appearance.combinedLicencePill,
    editing,
    useTrackOutline,
    reportPageRect,
  };
}

/**
 * Hidden probe that carries the table font (and --ov-cell-pad-x) so the window can report one `ch`
 * of it to main. Outside the zoom wrapper and always rendered, even while the overlay is hidden.
 */
function TableMetricsProbe() {
  const ref = useRef<HTMLDivElement>(null);
  useReportTableMetrics(ref);
  return (
    <div className="ov-table ov-metrics-probe" aria-hidden="true" ref={ref}>
      <span className="ov-metrics-ch" />
    </div>
  );
}

/** Loads settings, applies the theme, provides the runtime and renders one overlay instance. */
export function OverlayHost({
  module,
  instanceId = module.manifest.id,
}: {
  module: OverlayModule;
  /** Which instance of the overlay this window shows; instance 1 by default. */
  instanceId?: string;
}) {
  useApplyTheme();
  const settings = useOverlaySettings(instanceId);
  const app = useAppSettings();
  const editing = useEditMode();
  const view = useTelemetry(hostView, HOST_VIEW_HZ);

  const reduced = app?.performance.reduceVisualEffects ?? false;
  useEffect(() => {
    const root = document.documentElement;
    if (reduced) root.dataset["reducedEffects"] = "true";
    else delete root.dataset["reducedEffects"];
  }, [reduced]);

  const runtime = useMemo(
    () => (app === null ? null : runtimeOf(app, module, editing)),
    [app, module, editing],
  );

  if (settings === null || app === null || runtime === null) return null;
  return (
    <OverlayRuntimeContext.Provider value={runtime}>
      {module.manifest.table && <TableMetricsProbe />}
      <OverlayContent
        module={module}
        settings={settings}
        autoHide={app.general.autoHide}
        view={view}
        editing={editing}
        title={instanceTitle(module.manifest, instanceId, settings.name)}
      />
    </OverlayRuntimeContext.Provider>
  );
}
