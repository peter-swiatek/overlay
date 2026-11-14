import type { OverlayModule } from "../module";
import { flatTrackMapManifest } from "./manifest";
import { FlatTrackMapOverlay } from "./FlatTrackMapOverlay";

export { flatTrackMapManifest };

export const flatTrackMapModule: OverlayModule = {
  manifest: flatTrackMapManifest,
  Component: FlatTrackMapOverlay,
};
