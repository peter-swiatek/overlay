import type { OverlayModule } from "../module";
import { demoInputsManifest } from "./manifest";
import { DemoInputsOverlay } from "./DemoInputsOverlay";

export { demoInputsManifest };

export const demoInputsModule: OverlayModule = {
  manifest: demoInputsManifest,
  Component: DemoInputsOverlay,
};
