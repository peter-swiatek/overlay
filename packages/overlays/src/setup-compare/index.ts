import type { OverlayModule } from "../module";
import { setupCompareManifest } from "./manifest";
import { SetupCompareOverlay } from "./SetupCompareOverlay";

export { setupCompareManifest };

export const setupCompareModule: OverlayModule = {
  manifest: setupCompareManifest,
  Component: SetupCompareOverlay,
};
