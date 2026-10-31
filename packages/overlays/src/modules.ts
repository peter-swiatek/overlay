import type { OverlayModule } from "./module";
import { relativeModule } from "./relative";
import { leaderboardModule } from "./leaderboard";
import { spotterModule } from "./spotter";
import { pitSpeedModule } from "./pit-speed";
import { fuelModule } from "./fuel";
import { demoInputsModule } from "./demo-inputs";

export const OVERLAY_MODULES: readonly OverlayModule[] = [
  relativeModule,
  leaderboardModule,
  spotterModule,
  pitSpeedModule,
  fuelModule,
  demoInputsModule,
];

export function moduleById(id: string): OverlayModule | undefined {
  return OVERLAY_MODULES.find((m) => m.manifest.id === id);
}
