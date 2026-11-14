import { createContext, useContext } from "react";
import type { Corner, TelemetryFrame, TrackOutline } from "@overlay/sim-core/types";
import { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from "@overlay/ui/types";
import type { PageRect } from "./contract";

/** Gets the newest frame (null before the first) and whether the stream went stale. */
export type TelemetrySelector<T> = (frame: TelemetryFrame | null, stale: boolean) => T;

/** The shape of the track being driven and our corner list for it (empty when we have none). */
export interface TrackMapData {
  outline: TrackOutline;
  corners: readonly Corner[];
}

/**
 * Fetches the outline of `trackKey` while `ready` (from `derived.track`); null until it arrives,
 * when there is none, or when the key changes. Frames do not carry the outline: it is large.
 */
export type UseTrackOutline = (trackKey: string | null, ready: boolean) => TrackMapData | null;

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
  /**
   * Absent in hosts that cannot fetch outlines (the settings preview): the Track Map then draws
   * its built-in sample track.
   */
  useTrackOutline?: UseTrackOutline;
  /**
   * Overlay windows only (absent in the settings preview): where the Webview overlay's page goes,
   * in CSS px of the window, or null to hide it. The host places the page there; the overlay never
   * loads it itself.
   */
  reportPageRect?: (rect: PageRect | null) => void;
}

export const OverlayRuntimeContext = createContext<OverlayRuntime | null>(null);

/** The runtime the host provides; throws when rendered outside a provider. */
export function useOverlayRuntime(): OverlayRuntime {
  const runtime = useContext(OverlayRuntimeContext);
  if (runtime === null)
    throw new Error("useOverlayRuntime needs an OverlayRuntimeContext provider");
  return runtime;
}

/**
 * Test helper: a runtime whose useTelemetry returns selector(frame, false) and whose
 * useTrackOutline returns `track` when `ready` (null by default).
 */
export function staticRuntime(
  frame: TelemetryFrame | null,
  overrides: Partial<OverlayRuntime> = {},
  track: TrackMapData | null = null,
): OverlayRuntime {
  return {
    useTelemetry: (selector) => selector(frame, false),
    useTrackOutline: (_key, ready) => (ready ? track : null),
    prefs: DEFAULT_DISPLAY_PREFS,
    livePositions: true,
    reduceVisualEffects: false,
    combinedLicencePill: false,
    editing: false,
    ...overrides,
  };
}
