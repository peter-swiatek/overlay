import type { OverlayModule } from "../module";
import { rejoinHelperManifest } from "./manifest";
import { RejoinHelperOverlay } from "./RejoinHelperOverlay";

export { rejoinHelperManifest };

export const rejoinHelperModule: OverlayModule = {
  manifest: rejoinHelperManifest,
  Component: RejoinHelperOverlay,
};
