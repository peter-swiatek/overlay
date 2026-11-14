/**
 * The Twitch Chat overlay's options and the pieces the main process shares with it (channel names,
 * the IRC parser, the chat list). No React or CSS here: main imports this module.
 */
import type { OverlayInstanceSettings, SettingOption } from "../contract";
import { parseTwitchChannel } from "./channel";

export * from "./channel";
export * from "./irc";
export * from "./state";
export type * from "./types";

/** The manifest id; main connects only for windows of this overlay. */
export const TWITCH_CHAT_OVERLAY_ID = "twitch-chat";

/** Twitch's public chat server (IRC over WebSocket). */
export const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";

export const TWITCH_CHAT_KEYS = {
  channel: "channel",
  direction: "direction",
  fade: "fade-after",
  maxMessages: "max-messages",
  timestamps: "show-timestamps",
  badges: "show-badges",
  hideCommands: "hide-commands",
  header: "show-header",
} as const;

export const DIRECTION_OPTIONS: readonly SettingOption[] = [
  { value: "bottom-up", label: "Bottom-up (newest at the bottom)" },
  { value: "top-down", label: "Top-down (newest at the top)" },
];

export const FADE_OPTIONS: readonly SettingOption[] = [
  { value: "off", label: "Off" },
  { value: "15", label: "15 s" },
  { value: "30", label: "30 s" },
  { value: "45", label: "45 s" },
  { value: "60", label: "60 s" },
  { value: "120", label: "120 s" },
];

export const MAX_MESSAGES_LIMITS = { min: 5, max: 150, step: 5, default: 50 } as const;

export type ChatDirection = "bottom-up" | "top-down";

export interface TwitchChatOptions {
  /** Lowercase login, or null when none (or none valid) is set. */
  channel: string | null;
  direction: ChatDirection;
  /** Seconds after which a message fades out; null: never. */
  fadeS: number | null;
  maxMessages: number;
  timestamps: boolean;
  badges: boolean;
  hideCommands: boolean;
  header: boolean;
}

/** Typed options with safe fallbacks: never throws on odd stored data. */
export function twitchChatOptions(
  settings: Pick<OverlayInstanceSettings, "options">,
): TwitchChatOptions {
  const o = settings.options;
  const K = TWITCH_CHAT_KEYS;
  const fade = o[K.fade];
  const fadeS = typeof fade === "string" && /^\d+$/.test(fade) ? Number(fade) : null;
  const max = o[K.maxMessages];
  const L = MAX_MESSAGES_LIMITS;
  return {
    channel: parseTwitchChannel(o[K.channel]),
    direction: o[K.direction] === "top-down" ? "top-down" : "bottom-up",
    fadeS: fade === undefined ? 45 : fadeS !== null && fadeS > 0 ? fadeS : null,
    maxMessages:
      typeof max === "number" && Number.isFinite(max)
        ? Math.min(L.max, Math.max(L.min, Math.round(max)))
        : L.default,
    timestamps: o[K.timestamps] !== false,
    badges: o[K.badges] !== false,
    hideCommands: o[K.hideCommands] === true,
    header: o[K.header] !== false,
  };
}
