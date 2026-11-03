import type { OverlayModule } from "../module";
import { compactHudManifest } from "./manifest";
import { CompactHudOverlay } from "./CompactHudOverlay";

export { compactHudManifest };

export const compactHudModule: OverlayModule = {
  manifest: compactHudManifest,
  Component: CompactHudOverlay,
};
