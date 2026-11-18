import type { OverlayModule } from "../module";
import { battleBoxManifest } from "./manifest";
import { BattleBoxOverlay } from "./BattleBoxOverlay";

export { battleBoxManifest };

export const battleBoxModule: OverlayModule = {
  manifest: battleBoxManifest,
  Component: BattleBoxOverlay,
};
