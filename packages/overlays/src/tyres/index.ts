import type { OverlayModule } from "../module";
import { TyresOverlay } from "./TyresOverlay";
import { tyresManifest } from "./manifest";

export { tyresManifest };

export const tyresModule: OverlayModule = {
  manifest: tyresManifest,
  Component: TyresOverlay,
};
