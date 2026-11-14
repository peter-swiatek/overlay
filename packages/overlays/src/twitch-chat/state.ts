/**
 * The chat list: applying events from the server and choosing what shows. Pure; the main process
 * keeps each channel's recent messages with the same functions the overlay uses.
 */
import type { ChatEvent, ChatMessage, ChatStatus } from "./types";

/** Most messages kept per channel (the "Max messages" setting picks from these). */
export const MAX_KEPT_MESSAGES = 200;

export interface ChatState {
  channel: string | null;
  /** Null until the host has sent the first snapshot. */
  status: ChatStatus | null;
  /** Oldest first. */
  messages: readonly ChatMessage[];
}

export const INITIAL_CHAT_STATE: ChatState = { channel: null, status: null, messages: [] };

/** Messages without those of a timed-out or banned user (by user id when known, else login). */
export function withoutUser(
  messages: readonly ChatMessage[],
  login: string,
  userId: string | null,
): readonly ChatMessage[] {
  return messages.filter((m) =>
    userId !== null && m.userId !== null ? m.userId !== userId : m.login !== login,
  );
}

/** Adds, removes or replaces messages as `event` says; keeps at most `max`, dropping the oldest. */
export function applyChatEvent(
  state: ChatState,
  event: ChatEvent,
  max: number = MAX_KEPT_MESSAGES,
): ChatState {
  switch (event.type) {
    case "snapshot":
      return { channel: event.channel, status: event.status, messages: event.messages.slice(-max) };
    case "status":
      return { ...state, status: event.status };
    case "message": {
      if (state.messages.some((m) => m.id === event.message.id)) return state;
      const next = [...state.messages, event.message];
      return { ...state, messages: next.length > max ? next.slice(-max) : next };
    }
    case "clear-user":
      return { ...state, messages: withoutUser(state.messages, event.login, event.userId) };
    case "clear-all":
      return { ...state, messages: [] };
    case "delete":
      return { ...state, messages: state.messages.filter((m) => m.id !== event.id) };
    default:
      return state;
  }
}

/** A bot command such as "!discord" (hidden when the setting is on). */
export function isCommandMessage(message: Pick<ChatMessage, "text">): boolean {
  return message.text.trimStart().startsWith("!");
}

export interface ChatViewOptions {
  maxMessages: number;
  /** Messages older than this (by arrival) are gone; null: they stay. */
  fadeMs: number | null;
  hideCommands: boolean;
  nowMs: number;
}

/** The messages to draw, oldest first. */
export function visibleMessages(
  messages: readonly ChatMessage[],
  o: ChatViewOptions,
): ChatMessage[] {
  const shown = messages.filter(
    (m) =>
      !(o.hideCommands && isCommandMessage(m)) &&
      (o.fadeMs === null || o.nowMs - m.receivedAt < o.fadeMs),
  );
  return shown.slice(-Math.max(1, Math.floor(o.maxMessages)));
}

/** "17:31" in local time, 24-hour. */
export function chatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
