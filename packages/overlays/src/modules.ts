import type { OverlayModule } from "./module";
import { relativeModule } from "./relative";
import { leaderboardModule } from "./leaderboard";
import { spotterModule } from "./spotter";
import { pitSpeedModule } from "./pit-speed";
import { fuelModule } from "./fuel";
import { compactHudModule } from "./compact-hud";
import { deltaBarModule } from "./delta-bar";
import { telemetryStripModule } from "./telemetry-strip";
import { weatherModule } from "./weather";
import { inputsModule } from "./inputs";
import { trackMapModule } from "./track-map";

export const OVERLAY_MODULES: readonly OverlayModule[] = [
  relativeModule,
  leaderboardModule,
  spotterModule,
  pitSpeedModule,
  fuelModule,
  compactHudModule,
  deltaBarModule,
  telemetryStripModule,
  weatherModule,
  inputsModule,
  trackMapModule,
];

export function moduleById(id: string): OverlayModule | undefined {
  return OVERLAY_MODULES.find((m) => m.manifest.id === id);
}
