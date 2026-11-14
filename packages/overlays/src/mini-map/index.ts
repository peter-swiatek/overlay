import type { OverlayModule } from "../module";
import { miniMapManifest } from "./manifest";
import { MiniMapOverlay } from "./MiniMapOverlay";

export { miniMapManifest };

export const miniMapModule: OverlayModule = {
  manifest: miniMapManifest,
  Component: MiniMapOverlay,
};
