import type { OverlayModule } from "../module";
import { CarStatusOverlay } from "./CarStatusOverlay";
import { carStatusManifest } from "./manifest";

export { carStatusManifest };

export const carStatusModule: OverlayModule = {
  manifest: carStatusManifest,
  Component: CarStatusOverlay,
};
