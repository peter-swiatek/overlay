import { describe, expect, it } from "vitest";
import {
  INITIAL_CHAT_STATE,
  applyChatEvent,
  chatTime,
  isCommandMessage,
  visibleMessages,
  type ChatState,
} from "./state";
import type { ChatMessage } from "./types";

const T = 1_700_000_000_000;

function msg(id: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    login: `user_${id}`,
    userId: null,
    name: `User_${id}`,
    color: null,
    role: null,
    text: `message ${id}`,
    action: false,
    emotes: [],
    sentAt: T,
    receivedAt: T,
    ...over,
  };
}

const connected = { state: "connected", notice: null } as const;

function withMessages(...messages: ChatMessage[]): ChatState {
  return applyChatEvent(INITIAL_CHAT_STATE, {
    type: "snapshot",
    channel: "some_channel",
    status: connected,
    messages,
  });
}

describe("applyChatEvent", () => {
  it("replaces everything on a snapshot", () => {
    const s = withMessages(msg("a"), msg("b"));
    expect(s.channel).toBe("some_channel");
    expect(s.status).toEqual(connected);
    expect(s.messages.map((m) => m.id)).toEqual(["a", "b"]);
    const next = applyChatEvent(s, {
      type: "snapshot",
      channel: null,
      status: { state: "idle", notice: null },
      messages: [],
    });
    expect(next).toEqual({ channel: null, status: { state: "idle", notice: null }, messages: [] });
  });

  it("appends messages, once each, keeping the newest `max`", () => {
    let s = withMessages(msg("a"));
    s = applyChatEvent(s, { type: "message", message: msg("b") });
    s = applyChatEvent(s, { type: "message", message: msg("b") });
    expect(s.messages.map((m) => m.id)).toEqual(["a", "b"]);
    s = applyChatEvent(s, { type: "message", message: msg("c") }, 2);
    expect(s.messages.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("removes a timed-out user's messages by user id, or by login without one", () => {
    const s = withMessages(
      msg("a", { login: "x", userId: "1" }),
      msg("b", { login: "y", userId: "2" }),
      msg("c", { login: "x", userId: "1" }),
      msg("d", { login: "z" }),
    );
    expect(
      applyChatEvent(s, { type: "clear-user", login: "x", userId: "1" }).messages.map((m) => m.id),
    ).toEqual(["b", "d"]);
    expect(
      applyChatEvent(s, { type: "clear-user", login: "z", userId: null }).messages.map((m) => m.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("clears the chat and deletes single messages", () => {
    const s = withMessages(msg("a"), msg("b"));
    expect(applyChatEvent(s, { type: "clear-all" }).messages).toEqual([]);
    expect(applyChatEvent(s, { type: "delete", id: "a" }).messages.map((m) => m.id)).toEqual(["b"]);
  });

  it("updates the status only on a status event", () => {
    const s = withMessages(msg("a"));
    const next = applyChatEvent(s, {
      type: "status",
      status: { state: "reconnecting", notice: null },
    });
    expect(next.status?.state).toBe("reconnecting");
    expect(next.messages).toBe(s.messages);
  });
});

describe("visibleMessages", () => {
  const base = { maxMessages: 50, fadeMs: null, hideCommands: false, nowMs: T };

  it("keeps the newest `maxMessages`, oldest first", () => {
    const list = ["a", "b", "c"].map((id) => msg(id));
    expect(visibleMessages(list, { ...base, maxMessages: 2 }).map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("drops faded messages by arrival time", () => {
    const list = [msg("old", { receivedAt: T - 45_000 }), msg("new", { receivedAt: T - 44_999 })];
    expect(visibleMessages(list, { ...base, fadeMs: 45_000 }).map((m) => m.id)).toEqual(["new"]);
    expect(visibleMessages(list, base)).toHaveLength(2);
  });

  it("hides bot commands when asked", () => {
    const list = [msg("a", { text: "  !discord" }), msg("b", { text: "hi !there" })];
    expect(isCommandMessage(list[0]!)).toBe(true);
    expect(isCommandMessage(list[1]!)).toBe(false);
    expect(visibleMessages(list, { ...base, hideCommands: true }).map((m) => m.id)).toEqual(["b"]);
    expect(visibleMessages(list, base)).toHaveLength(2);
  });
});

describe("chatTime", () => {
  it("formats local 24-hour time", () => {
    const d = new Date(2026, 10, 14, 7, 5, 59);
    expect(chatTime(d.getTime())).toBe("07:05");
    expect(chatTime(new Date(2026, 10, 14, 17, 31).getTime())).toBe("17:31");
  });
});
