import type { OverlayModule } from "../module";
import { digiFlagManifest } from "./manifest";
import { DigiFlagOverlay } from "./DigiFlagOverlay";

export { digiFlagManifest };

export const digiFlagModule: OverlayModule = {
  manifest: digiFlagManifest,
  Component: DigiFlagOverlay,
};
