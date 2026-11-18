import type { OverlayModule } from "../module";
import { telemetryStripManifest } from "./manifest";
import { TelemetryStripOverlay } from "./TelemetryStripOverlay";

export { telemetryStripManifest };

export const telemetryStripModule: OverlayModule = {
  manifest: telemetryStripManifest,
  Component: TelemetryStripOverlay,
};
