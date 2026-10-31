import { useEffect, useMemo } from "react";
import { OverlayRuntimeContext, type OverlayModule, type OverlayRuntime } from "@overlay/overlays";
import type { TelemetrySelector } from "@overlay/overlays";
import { displayPrefsOf, type AppSettings } from "../../shared/app-settings-types";
import { useTelemetry } from "../telemetry/useTelemetry";
import { useApplyTheme } from "../theme/useApplyTheme";
import { OverlayContent } from "./OverlayContent";
import { cappedRateHz, hostView } from "./visibility";
import { useAppSettings, useEditMode, useOverlaySettings } from "./useSettings";

const HOST_VIEW_HZ = 5;

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
  };
}

/** Loads settings, applies the theme, provides the runtime and renders one overlay module. */
export function OverlayHost({ module }: { module: OverlayModule }) {
  useApplyTheme();
  const settings = useOverlaySettings(module.manifest.id);
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
      <OverlayContent
        module={module}
        settings={settings}
        autoHide={app.general.autoHide}
        view={view}
        editing={editing}
      />
    </OverlayRuntimeContext.Provider>
  );
}
