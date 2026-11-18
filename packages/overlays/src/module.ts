import type { ComponentType } from "react";
import type { OverlayInstanceSettings, OverlayManifest } from "./contract";

export interface OverlayProps {
  settings: OverlayInstanceSettings;
}

export interface OverlayModule {
  manifest: OverlayManifest;
  Component: ComponentType<OverlayProps>;
}
