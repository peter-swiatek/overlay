import type { OverlayModule } from "./module";
import { relativeModule } from "./relative";
import { leaderboardModule } from "./leaderboard";
import { battleBoxModule } from "./battle-box";
import { spotterModule } from "./spotter";
import { pitSpeedModule } from "./pit-speed";
import { fuelModule } from "./fuel";
import { compactHudModule } from "./compact-hud";
import { deltaBarModule } from "./delta-bar";
import { telemetryStripModule } from "./telemetry-strip";
import { weatherModule } from "./weather";
import { inputsModule } from "./inputs";
import { trackMapModule } from "./track-map";
import { lapTimesModule } from "./lap-times";
import { incidentsModule } from "./incidents";
import { incidentLogModule } from "./incident-log";
import { incidentBarModule } from "./incident-bar";
import { digiFlagModule } from "./digi-flag";
import { rejoinHelperModule } from "./rejoin-helper";
import { tyresModule } from "./tyres";
import { radarModule } from "./radar";
import { miniMapModule } from "./mini-map";
import { flatTrackMapModule } from "./flat-track-map";

export const OVERLAY_MODULES: readonly OverlayModule[] = [
  relativeModule,
  leaderboardModule,
  battleBoxModule,
  spotterModule,
  pitSpeedModule,
  fuelModule,
  compactHudModule,
  deltaBarModule,
  telemetryStripModule,
  weatherModule,
  inputsModule,
  trackMapModule,
  lapTimesModule,
  incidentsModule,
  incidentLogModule,
  incidentBarModule,
  digiFlagModule,
  rejoinHelperModule,
  tyresModule,
  radarModule,
  miniMapModule,
  flatTrackMapModule,
];

export function moduleById(id: string): OverlayModule | undefined {
  return OVERLAY_MODULES.find((m) => m.manifest.id === id);
}
