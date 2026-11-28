import type { OverlayModule } from "../module";
import { vehicleDamageManifest } from "./manifest";
import { VehicleDamageOverlay } from "./VehicleDamageOverlay";

export { vehicleDamageManifest };

export const vehicleDamageModule: OverlayModule = {
  manifest: vehicleDamageManifest,
  Component: VehicleDamageOverlay,
};
