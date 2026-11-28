import type { OverlayModule } from "../module";
import { webviewManifest } from "./manifest";
import { WebviewOverlay } from "./WebviewOverlay";

export { webviewManifest };

export const webviewModule: OverlayModule = {
  manifest: webviewManifest,
  Component: WebviewOverlay,
};
