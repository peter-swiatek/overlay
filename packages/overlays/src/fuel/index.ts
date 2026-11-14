import type { OverlayModule } from "../module";
import { fuelManifest } from "./manifest";
import { FuelOverlay } from "./FuelOverlay";

export { fuelManifest };

export const fuelModule: OverlayModule = {
  manifest: fuelManifest,
  Component: FuelOverlay,
};
