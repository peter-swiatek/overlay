import type { OverlayModule } from "../module";
import { DataFramesOverlay } from "./DataFramesOverlay";
import { dataFramesManifest } from "./manifest";

export { dataFramesManifest };

export const dataFramesModule: OverlayModule = {
  manifest: dataFramesManifest,
  Component: DataFramesOverlay,
};
