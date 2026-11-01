import { forwardRef } from "react";
import { OverlayRuntimeContext, type OverlayModule, type OverlayRuntime } from "@overlay/overlays";
import type { OverlayInstanceSettings } from "@overlay/overlays/contract";
import type { Theme } from "@overlay/theme/types";
import { ThemeScope } from "../appearance/ThemeScope";
import { OverlayErrorBoundary } from "../../overlay/ErrorBoundary";
import { contentStyle } from "../../overlay/OverlayFrame";
import type { OverlaySize } from "../../../shared/types";
import "./preview.css";

export interface PreviewStageProps {
  module: OverlayModule;
  settings: OverlayInstanceSettings;
  /** Real window size and scale of the overlay. */
  size: OverlaySize;
  /** Scale that fits the window into the pane (1 when there is room). */
  fit: number;
  /** The settings window's own CSS zoom, divided out so the preview shows real sizes. */
  shellZoom: number;
  runtime: OverlayRuntime;
  theme: Theme;
}

/**
 * The overlay as its window draws it, minus the Hidden rules (it always shows): real window
 * size, the overlay's own scale/opacity, scaled down by `fit`. Everything is scoped to
 * `.pv-*` and a ThemeScope; the overlay window's stylesheet is never loaded here.
 */
export const PreviewStage = forwardRef<HTMLDivElement, PreviewStageProps>(function PreviewStage(
  { module, settings, size, fit, shellZoom, runtime, theme },
  ref,
) {
  const { manifest, Component } = module;
  return (
    <div
      className="pv-sizer"
      ref={ref}
      style={{
        width: size.width * fit,
        height: size.height * fit,
        zoom: shellZoom === 1 ? undefined : 1 / shellZoom,
      }}
    >
      <div
        className="pv-scale"
        style={{ width: size.width, height: size.height, transform: `scale(${fit})` }}
      >
        <ThemeScope theme={theme} className="pv-window">
          <div className="pv-content" style={contentStyle(settings.common, manifest.table)}>
            <div className="pv-fit">
              <span className="pv-ch-probe" aria-hidden="true" />
              <OverlayErrorBoundary resetKey={settings} name={manifest.id}>
                <OverlayRuntimeContext.Provider value={runtime}>
                  <Component settings={settings} />
                </OverlayRuntimeContext.Provider>
              </OverlayErrorBoundary>
            </div>
          </div>
        </ThemeScope>
      </div>
    </div>
  );
});
