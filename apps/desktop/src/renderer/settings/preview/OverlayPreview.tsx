import type { OverlayInstanceSettings, OverlayManifest } from "@overlay/overlays/contract";
import type { OverlaySize } from "../../../shared/types";

/** What the preview measures from the rendered overlay, for the column width floor. */
export interface PreviewMeasure {
  /** Width of the overlay's table in CSS px at the overlay's real scale; 0 when there is none. */
  tableWidthPx: number;
  /** Width of one "0" character (the table's `ch`) in CSS px. */
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

/** Live preview of one overlay on demo data. Owned by MW-3; this stub renders nothing. */
export function OverlayPreview(props: OverlayPreviewProps): null {
  void props;
  return null;
}
