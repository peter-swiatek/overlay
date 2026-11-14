import type { OverlayModule } from "../module";
import { radarManifest } from "./manifest";
import { RadarOverlay } from "./RadarOverlay";

export { radarManifest };

export const radarModule: OverlayModule = {
  manifest: radarManifest,
  Component: RadarOverlay,
};
