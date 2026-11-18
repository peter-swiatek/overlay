import type { OverlayModule } from "../module";
import { incidentLogManifest } from "./manifest";
import { IncidentLogOverlay } from "./IncidentLogOverlay";

export { incidentLogManifest };

export const incidentLogModule: OverlayModule = {
  manifest: incidentLogManifest,
  Component: IncidentLogOverlay,
};
