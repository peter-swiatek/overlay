import { createContext, useContext } from "react";
import type { TelemetryFrame } from "@overlay/sim-core/types";
import { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from "@overlay/ui/types";

/** Gets the newest frame (null before the first) and whether the stream went stale. */
export type TelemetrySelector<T> = (frame: TelemetryFrame | null, stale: boolean) => T;

/** What the host gives every overlay component. The desktop host and tests provide one. */
export interface OverlayRuntime {
  /** Re-renders at most `rateHz` times a second, only when the selected value changed. */
  useTelemetry<T>(selector: TelemetrySelector<T>, rateHz: number): T;
  prefs: DisplayPrefs;
  /** Settings > Performance: distance-based live positions instead of official S/F positions. */
  livePositions: boolean;
  reduceVisualEffects: boolean;
  /** Settings > Appearance: tint the iRating pill with the licence colour. */
  combinedLicencePill: boolean;
  /** Edit mode (overlays unlocked). */
  editing: boolean;
}

export const OverlayRuntimeContext = createContext<OverlayRuntime | null>(null);

/** The runtime the host provides; throws when rendered outside a provider. */
export function useOverlayRuntime(): OverlayRuntime {
  const runtime = useContext(OverlayRuntimeContext);
  if (runtime === null)
    throw new Error("useOverlayRuntime needs an OverlayRuntimeContext provider");
  return runtime;
}

/** Test helper: a runtime whose useTelemetry returns selector(frame, false). */
export function staticRuntime(
  frame: TelemetryFrame | null,
  overrides: Partial<OverlayRuntime> = {},
): OverlayRuntime {
  return {
    useTelemetry: (selector) => selector(frame, false),
    prefs: DEFAULT_DISPLAY_PREFS,
    livePositions: true,
    reduceVisualEffects: false,
    combinedLicencePill: false,
    editing: false,
    ...overrides,
  };
}
