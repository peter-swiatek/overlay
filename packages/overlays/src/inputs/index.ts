import type { OverlayModule } from "../module";
import { inputsManifest } from "./manifest";
import { InputsOverlay } from "./InputsOverlay";

export { inputsManifest };

export const inputsModule: OverlayModule = {
  manifest: inputsManifest,
  Component: InputsOverlay,
};
