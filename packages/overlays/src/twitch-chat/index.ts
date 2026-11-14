import type { OverlayModule } from "../module";
import { twitchChatManifest } from "./manifest";
import { TwitchChatOverlay } from "./TwitchChatOverlay";

export { twitchChatManifest };

export const twitchChatModule: OverlayModule = {
  manifest: twitchChatManifest,
  Component: TwitchChatOverlay,
};
