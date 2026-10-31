import type { OverlayManifest } from "./contract";
import { relativeManifest } from "./relative/manifest";
import { leaderboardManifest } from "./leaderboard/manifest";
import { spotterManifest } from "./spotter/manifest";
import { pitSpeedManifest } from "./pit-speed/manifest";
import { fuelManifest } from "./fuel/manifest";

export const OVERLAY_MANIFESTS: readonly OverlayManifest[] = [
  relativeManifest,
  leaderboardManifest,
  spotterManifest,
  pitSpeedManifest,
  fuelManifest,
];

export function manifestById(id: string): OverlayManifest | undefined {
  return OVERLAY_MANIFESTS.find((m) => m.id === id);
}
