import type { OverlayModule } from "../module";
import { pitSpeedManifest } from "./manifest";
import { PitSpeedOverlay } from "./PitSpeedOverlay";

export { pitSpeedManifest };

export const pitSpeedModule: OverlayModule = {
  manifest: pitSpeedManifest,
  Component: PitSpeedOverlay,
};
