import type { OverlayModule } from "../module";
import { lapTimesManifest } from "./manifest";
import { LapTimesOverlay } from "./LapTimesOverlay";

export { lapTimesManifest };

export const lapTimesModule: OverlayModule = {
  manifest: lapTimesManifest,
  Component: LapTimesOverlay,
};
