/**
 * What the main process sends a Twitch Chat overlay window. Plain data only: it crosses IPC.
 */

/** The badge shown in front of a name; one per message, the highest role first. */
export type ChatRole = "broadcaster" | "moderator" | "vip" | "subscriber";

/** A run of code points [start, end] that Twitch marks as an emote (shown as its text). */
export interface EmoteRange {
  start: number;
  end: number;
}

export interface ChatMessage {
  /** Twitch's message id (CLEARMSG removes by it). */
  id: string;
  /** Lowercase login of the sender (CLEARCHAT removes by it). */
  login: string;
  /** Twitch user id of the sender, when sent. */
  userId: string | null;
  /** Display name (or the login). */
  name: string;
  /** The sender's chosen name colour as "#rrggbb", or null when unset or malformed. */
  color: string | null;
  role: ChatRole | null;
  /** Message text, without the /me wrapper. Always shown as text, never as markup. */
  text: string;
  /** Sent with /me: shown in italics. */
  action: boolean;
  emotes: readonly EmoteRange[];
  /** When Twitch received it (tmi-sent-ts), ms since the epoch; the arrival time when missing. */
  sentAt: number;
  /** When this app received it, ms since the epoch (drives the fade). */
  receivedAt: number;
}

export type ChatConnectionState =
  /** No channel set. */
  | "idle"
  | "connecting"
  /** Joined the channel: messages arrive as they are sent. */
  | "connected"
  /** The connection dropped; the next try is under way or scheduled. */
  | "reconnecting";

export interface ChatStatus {
  state: ChatConnectionState;
  /** The last notice from Twitch about the channel (for example a suspended channel), or null. */
  notice: string | null;
}

export type ChatEvent =
  /** Everything at once: sent when a window asks and when its channel changes. */
  | { type: "snapshot"; channel: string | null; status: ChatStatus; messages: ChatMessage[] }
  | { type: "status"; status: ChatStatus }
  | { type: "message"; message: ChatMessage }
  /** A user was timed out or banned: their messages go. */
  | { type: "clear-user"; login: string; userId: string | null }
  /** A moderator cleared the chat. */
  | { type: "clear-all" }
  /** A moderator deleted one message. */
  | { type: "delete"; id: string };
