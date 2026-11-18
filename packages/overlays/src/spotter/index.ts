import type { OverlayModule } from "../module";
import { spotterManifest } from "./manifest";
import { SpotterOverlay } from "./SpotterOverlay";

export { spotterManifest };

export const spotterModule: OverlayModule = {
  manifest: spotterManifest,
  Component: SpotterOverlay,
};
