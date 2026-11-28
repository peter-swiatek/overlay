import type { OverlayManifest } from "../contract";
import { MAX_CHANNEL_INPUT_LENGTH } from "./channel";
import {
  DIRECTION_OPTIONS,
  FADE_OPTIONS,
  MAX_MESSAGES_LIMITS,
  TWITCH_CHAT_KEYS as K,
  TWITCH_CHAT_OVERLAY_ID,
} from "./options";

export const twitchChatManifest: OverlayManifest = {
  id: TWITCH_CHAT_OVERLAY_ID,
  title: "Twitch Chat",
  description:
    "A Twitch channel's chat, read-only: time, role badge, name in the user's colour and message, newest at the bottom. Connects anonymously; it never sends anything to the chat.",
  sims: ["iracing", "lmu"],
  defaultSize: { width: 320, height: 360 },
  minSize: { width: 180, height: 120 },
  defaultPosition: { x: 40, y: 420 },
  table: false,
  fields: [],
  settings: [
    {
      key: K.channel,
      label: "Channel",
      kind: "text",
      section: "Channel",
      default: "",
      maxLength: MAX_CHANNEL_INPUT_LENGTH,
      format: "twitch-channel",
      placeholder: "channel_name",
      help: "The Twitch channel to read, as its name or its twitch.tv address. The chat is read anonymously over Twitch's public chat server; no account or sign-in is needed.",
    },
    {
      key: K.direction,
      label: "Direction",
      kind: "select",
      section: "Messages",
      default: "bottom-up",
      options: DIRECTION_OPTIONS,
    },
    {
      key: K.fade,
      label: "Fade messages after",
      kind: "select",
      section: "Messages",
      default: "45",
      options: FADE_OPTIONS,
      help: "Messages fade out this long after they arrive.",
    },
    {
      key: K.maxMessages,
      label: "Max messages",
      kind: "number",
      section: "Messages",
      default: MAX_MESSAGES_LIMITS.default,
      min: MAX_MESSAGES_LIMITS.min,
      max: MAX_MESSAGES_LIMITS.max,
      step: MAX_MESSAGES_LIMITS.step,
    },
    {
      key: K.hideCommands,
      label: "Hide bot commands",
      kind: "toggle",
      section: "Messages",
      default: false,
      help: 'Hides messages that start with "!", such as !discord.',
    },
    {
      key: K.timestamps,
      label: "Show timestamps",
      kind: "toggle",
      section: "Layout",
      default: true,
    },
    {
      key: K.badges,
      label: "Show badges",
      kind: "toggle",
      section: "Layout",
      default: true,
      help: "Broadcaster, moderator, VIP and subscriber badges in front of names.",
    },
    {
      key: K.header,
      label: "Show header",
      kind: "toggle",
      section: "Layout",
      default: true,
      help: "The channel name above the messages.",
    },
  ],
  // No telemetry: the chat brings its own data.
  rateHz: 1,
  defaultEnabled: false,
  needsTelemetry: false,
  // The channel name stays readable while editing.
  editTitleBarInFlow: true,
};
