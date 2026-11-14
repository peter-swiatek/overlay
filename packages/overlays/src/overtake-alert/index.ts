import type { OverlayModule } from "../module";
import { overtakeAlertManifest } from "./manifest";
import { OvertakeAlertOverlay } from "./OvertakeAlertOverlay";

export { overtakeAlertManifest };

export const overtakeAlertModule: OverlayModule = {
  manifest: overtakeAlertManifest,
  Component: OvertakeAlertOverlay,
};
