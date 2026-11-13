import type { OverlayModule } from "../module";
import { incidentBarManifest } from "./manifest";
import { IncidentBarOverlay } from "./IncidentBarOverlay";

export { incidentBarManifest };

export const incidentBarModule: OverlayModule = {
  manifest: incidentBarManifest,
  Component: IncidentBarOverlay,
};
