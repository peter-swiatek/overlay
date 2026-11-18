import type { OverlayModule } from "../module";
import { relativeManifest } from "./manifest";
import { RelativeOverlay } from "./RelativeOverlay";

export { relativeManifest };

export const relativeModule: OverlayModule = {
  manifest: relativeManifest,
  Component: RelativeOverlay,
};
