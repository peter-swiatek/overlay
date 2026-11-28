import type { OverlayModule } from "../module";
import { trackMapManifest } from "./manifest";
import { TrackMapOverlay } from "./TrackMapOverlay";

export { trackMapManifest };

export const trackMapModule: OverlayModule = {
  manifest: trackMapManifest,
  Component: TrackMapOverlay,
};
