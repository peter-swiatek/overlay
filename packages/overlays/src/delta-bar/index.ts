import type { OverlayModule } from "../module";
import { deltaBarManifest } from "./manifest";
import { DeltaBarOverlay } from "./DeltaBarOverlay";

export { deltaBarManifest };

export const deltaBarModule: OverlayModule = {
  manifest: deltaBarManifest,
  Component: DeltaBarOverlay,
};
