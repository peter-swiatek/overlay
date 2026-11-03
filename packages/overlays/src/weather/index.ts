import type { OverlayModule } from "../module";
import { weatherManifest } from "./manifest";
import { WeatherOverlay } from "./WeatherOverlay";

export { weatherManifest };

export const weatherModule: OverlayModule = {
  manifest: weatherManifest,
  Component: WeatherOverlay,
};
