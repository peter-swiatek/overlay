import type { OverlayModule } from "../module";
import { leaderboardManifest } from "./manifest";
import { LeaderboardOverlay } from "./LeaderboardOverlay";

export { leaderboardManifest };

export const leaderboardModule: OverlayModule = {
  manifest: leaderboardManifest,
  Component: LeaderboardOverlay,
};
