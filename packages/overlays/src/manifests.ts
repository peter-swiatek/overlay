import type { OverlayManifest } from "./contract";
import { relativeManifest } from "./relative/manifest";
import { leaderboardManifest } from "./leaderboard/manifest";
import { battleBoxManifest } from "./battle-box/manifest";
import { spotterManifest } from "./spotter/manifest";
import { pitSpeedManifest } from "./pit-speed/manifest";
import { fuelManifest } from "./fuel/manifest";
import { compactHudManifest } from "./compact-hud/manifest";
import { deltaBarManifest } from "./delta-bar/manifest";
import { telemetryStripManifest } from "./telemetry-strip/manifest";
import { weatherManifest } from "./weather/manifest";
import { inputsManifest } from "./inputs/manifest";
import { trackMapManifest } from "./track-map/manifest";
import { lapTimesManifest } from "./lap-times/manifest";
import { incidentsManifest } from "./incidents/manifest";
import { incidentLogManifest } from "./incident-log/manifest";
import { incidentBarManifest } from "./incident-bar/manifest";
import { digiFlagManifest } from "./digi-flag/manifest";
import { rejoinHelperManifest } from "./rejoin-helper/manifest";
import { overtakeAlertManifest } from "./overtake-alert/manifest";
import { tyresManifest } from "./tyres/manifest";
import { radarManifest } from "./radar/manifest";
import { miniMapManifest } from "./mini-map/manifest";
import { flatTrackMapManifest } from "./flat-track-map/manifest";
import { dataFramesManifest } from "./data-frames/manifest";
import { vehicleDamageManifest } from "./vehicle-damage/manifest";
import { carStatusManifest } from "./car-status/manifest";
import { setupCompareManifest } from "./setup-compare/manifest";

export const OVERLAY_MANIFESTS: readonly OverlayManifest[] = [
  relativeManifest,
  leaderboardManifest,
  battleBoxManifest,
  spotterManifest,
  pitSpeedManifest,
  fuelManifest,
  compactHudManifest,
  deltaBarManifest,
  telemetryStripManifest,
  weatherManifest,
  inputsManifest,
  trackMapManifest,
  lapTimesManifest,
  incidentsManifest,
  incidentLogManifest,
  incidentBarManifest,
  digiFlagManifest,
  rejoinHelperManifest,
  overtakeAlertManifest,
  tyresManifest,
  radarManifest,
  miniMapManifest,
  flatTrackMapManifest,
  dataFramesManifest,
  vehicleDamageManifest,
  carStatusManifest,
  setupCompareManifest,
];

export function manifestById(id: string): OverlayManifest | undefined {
  return OVERLAY_MANIFESTS.find((m) => m.id === id);
}
