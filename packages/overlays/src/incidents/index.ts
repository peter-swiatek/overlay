import type { OverlayModule } from "../module";
import { IncidentsOverlay } from "./IncidentsOverlay";
import { incidentsManifest } from "./manifest";

export { incidentsManifest };

export const incidentsModule: OverlayModule = {
  manifest: incidentsManifest,
  Component: IncidentsOverlay,
};
