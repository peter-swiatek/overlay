import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { OverlayProps } from "../module";
import { useOverlayRuntime } from "../runtime";
import { nameColour } from "./colour";
import { messageSegments } from "./irc";
import { twitchChatOptions, type TwitchChatOptions } from "./options";
import { SAMPLE_CHANNEL, sampleMessages } from "./sample";
import { INITIAL_CHAT_STATE, chatTime, visibleMessages, type ChatState } from "./state";
import type { ChatMessage, ChatRole, ChatStatus } from "./types";
import "./twitch-chat.css";

/** Edit-mode text while no channel is set. */
export const NO_CHANNEL_TEXT = "Set a channel in settings";
/** How long the last step of a fade takes (the CSS transition). */
const FADE_OUT_MS = 1000;

export const BADGE_TEXT: Readonly<Record<ChatRole, string>> = {
  broadcaster: "BCAST",
  moderator: "MOD",
  vip: "VIP",
  subscriber: "SUB",
};

/** The line shown above the messages for the connection, or null when there is nothing to say. */
export function statusText(
  status: ChatStatus | null,
  channel: string,
  hasMessages: boolean,
  editing: boolean,
): string | null {
  if (status?.notice) return status.notice;
  switch (status?.state ?? "connecting") {
    case "connected":
      return !hasMessages && editing ? `Connected to #${channel}, no messages yet` : null;
    case "reconnecting":
      return "Disconnected, reconnecting…";
    case "idle":
    case "connecting":
      return `Connecting to #${channel}…`;
  }
}

/** "Bottom-up" / "Top-down" and "45s" / "Off", for the edit-mode footer. */
export function footerTexts(o: TwitchChatOptions): [string, string] {
  return [
    `Direction: ${o.direction === "top-down" ? "Top-down" : "Bottom-up"}`,
    `Fade: ${o.fadeS === null ? "Off" : `${o.fadeS}s`}`,
  ];
}

/** The settings preview has no connection. */
function useNoChat(): ChatState {
  return INITIAL_CHAT_STATE;
}

/** Re-renders every `ms` while `ms` is set; returns the current time. */
function useNow(ms: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms === null) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function Message({
  message: m,
  o,
  fadingOut,
}: {
  message: ChatMessage;
  o: TwitchChatOptions;
  fadingOut: boolean;
}) {
  const colour = useMemo(() => nameColour(m.color, m.login), [m.color, m.login]);
  const segments = useMemo(() => messageSegments(m.text, m.emotes), [m.text, m.emotes]);
  const classes = ["tc-msg"];
  if (m.role === "broadcaster") classes.push("tc-msg--broadcaster");
  if (fadingOut) classes.push("tc-msg--out");
  const nameStyle: CSSProperties = { color: colour };
  return (
    <div className={classes.join(" ")} data-msg={m.id}>
      {o.timestamps && <span className="tc-time">{chatTime(m.sentAt)}</span>}
      {o.badges && m.role !== null && (
        <span className={`tc-badge tc-badge--${m.role}`}>{BADGE_TEXT[m.role]}</span>
      )}
      <span className="tc-name" style={nameStyle}>
        {m.action ? m.name : `${m.name}:`}
      </span>{" "}
      <span
        className={m.action ? "tc-text tc-text--action" : "tc-text"}
        style={m.action ? nameStyle : undefined}
      >
        {segments.map((s, i) =>
          s.emote ? (
            <span key={i} className="tc-emote">
              {s.text}
            </span>
          ) : (
            s.text
          ),
        )}
      </span>
    </div>
  );
}

/**
 * A Twitch channel's chat. The host connects (read-only, anonymous) and sends the events; the
 * overlay keeps the list and draws it. Without a host connection (settings preview) or without a
 * channel in edit mode it shows made-up sample messages.
 */
export function TwitchChatOverlay({ settings }: OverlayProps) {
  const runtime = useOverlayRuntime();
  const { editing } = runtime;
  const o = twitchChatOptions(settings);
  const useChat = runtime.useTwitchChat ?? useNoChat;
  const state = useChat();

  const host = runtime.useTwitchChat !== undefined;
  const live = host && o.channel !== null;
  // Messages of the channel set now (a changed channel waits for its own snapshot).
  const liveMessages = live && state.channel === o.channel ? state.messages : [];
  const fadeMs = o.fadeS === null ? null : o.fadeS * 1000;
  const now = useNow(live && fadeMs !== null && liveMessages.length > 0 ? 1000 : null);

  // Nothing while driving without a channel.
  if (host && o.channel === null && !editing) return <></>;

  const sample = !live;
  const channel = o.channel ?? (host ? null : SAMPLE_CHANNEL);
  const messages = sample
    ? visibleMessages(sampleMessages(now), {
        maxMessages: o.maxMessages,
        fadeMs: null,
        hideCommands: o.hideCommands,
        nowMs: now,
      })
    : visibleMessages(liveMessages, {
        maxMessages: o.maxMessages,
        fadeMs,
        hideCommands: o.hideCommands,
        nowMs: now,
      });
  const status = live && state.channel === o.channel ? state.status : null;
  const connected = live && status?.state === "connected";
  const line =
    o.channel === null
      ? host
        ? NO_CHANNEL_TEXT
        : null
      : live
        ? statusText(status, o.channel, messages.length > 0, editing)
        : null;
  const ordered = o.direction === "top-down" ? [...messages].reverse() : messages;
  const [direction, fade] = footerTexts(o);

  return (
    <div className="tc" data-direction={o.direction} data-sample={sample || undefined}>
      {o.header && (
        <div className="tc-strip tc-strip--top">
          <span className="tc-item">
            <span className="tc-dot" data-live={connected || undefined} aria-hidden="true">
              ●
            </span>
            {channel === null ? (
              <span className="tc-label">No channel</span>
            ) : (
              <span className="tc-value">#{channel}</span>
            )}
          </span>
        </div>
      )}
      {line !== null && <div className="tc-status">{line}</div>}
      <div className="tc-list">
        {ordered.map((m) => (
          <Message
            key={m.id}
            message={m}
            o={o}
            fadingOut={!sample && fadeMs !== null && now - m.receivedAt >= fadeMs - FADE_OUT_MS}
          />
        ))}
      </div>
      {editing && (
        <div className="tc-strip tc-strip--footer">
          <span className="tc-label">{direction}</span>
          <span className="tc-label">{fade}</span>
        </div>
      )}
    </div>
  );
}
