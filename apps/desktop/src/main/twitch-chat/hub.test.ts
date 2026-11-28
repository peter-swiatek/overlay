import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@overlay/overlays/twitch-chat";
import { TwitchChatHub, type ChatWatcher, type HubConnection } from "./hub";

function harness() {
  const live = new Map<
    string,
    { onEvent: (e: ChatEvent) => void; started: number; stopped: number }
  >();
  const created: string[] = [];
  const hub = new TwitchChatHub((channel, onEvent): HubConnection => {
    created.push(channel);
    const entry = { onEvent, started: 0, stopped: 0 };
    live.set(channel, entry);
    return {
      start: () => entry.started++,
      stop: () => entry.stopped++,
      snapshot: () => ({
        type: "snapshot",
        channel,
        status: { state: "connected", notice: null },
        messages: [],
      }),
    };
  });
  const inbox = new Map<string, ChatEvent[]>();
  const watcher = (id: string, channel: string | null): ChatWatcher => ({
    id,
    channel,
    send: (e) => {
      const list = inbox.get(id) ?? [];
      list.push(e);
      inbox.set(id, list);
    },
  });
  return { hub, live, created, inbox, watcher };
}

const status: ChatEvent = { type: "status", status: { state: "reconnecting", notice: null } };

describe("TwitchChatHub", () => {
  it("shares one connection per channel between instances", () => {
    const h = harness();
    h.hub.sync([h.watcher("twitch-chat", "alpha"), h.watcher("twitch-chat#2", "alpha")]);
    expect(h.created).toEqual(["alpha"]);
    expect(h.live.get("alpha")!.started).toBe(1);
    expect(h.inbox.get("twitch-chat")?.[0]).toMatchObject({ type: "snapshot", channel: "alpha" });
    expect(h.inbox.get("twitch-chat#2")?.[0]).toMatchObject({ type: "snapshot", channel: "alpha" });
  });

  it("sends each window only its own channel's events", () => {
    const h = harness();
    h.hub.sync([h.watcher("twitch-chat", "alpha"), h.watcher("twitch-chat#2", "bravo")]);
    h.live.get("alpha")!.onEvent(status);
    expect(h.inbox.get("twitch-chat")?.at(-1)).toBe(status);
    expect(h.inbox.get("twitch-chat#2")).toHaveLength(1);
  });

  it("disconnects a channel no window shows any more, and sends the new one's snapshot", () => {
    const h = harness();
    h.hub.sync([h.watcher("twitch-chat", "alpha")]);
    h.hub.sync([h.watcher("twitch-chat", "bravo")]);
    expect(h.live.get("alpha")!.stopped).toBe(1);
    expect(h.hub.channels()).toEqual(["bravo"]);
    expect(h.inbox.get("twitch-chat")?.at(-1)).toMatchObject({
      type: "snapshot",
      channel: "bravo",
    });
  });

  it("connects to nothing without a channel and tells the window so", () => {
    const h = harness();
    h.hub.sync([h.watcher("twitch-chat", null)]);
    expect(h.created).toEqual([]);
    expect(h.inbox.get("twitch-chat")).toEqual([
      { type: "snapshot", channel: null, status: { state: "idle", notice: null }, messages: [] },
    ]);
  });

  it("sends no repeat snapshot when nothing changed, but one on hello", () => {
    const h = harness();
    h.hub.sync([h.watcher("twitch-chat", "alpha")]);
    h.hub.sync([h.watcher("twitch-chat", "alpha")]);
    expect(h.inbox.get("twitch-chat")).toHaveLength(1);
    expect(h.created).toEqual(["alpha"]);
    h.hub.hello("twitch-chat");
    expect(h.inbox.get("twitch-chat")).toHaveLength(2);
    h.hub.hello("unknown");
  });

  it("disconnects everything when the windows close or the app quits", () => {
    const h = harness();
    h.hub.sync([h.watcher("twitch-chat", "alpha"), h.watcher("twitch-chat#2", "bravo")]);
    h.hub.sync([h.watcher("twitch-chat#2", "bravo")]);
    expect(h.live.get("alpha")!.stopped).toBe(1);
    h.hub.stopAll();
    expect(h.live.get("bravo")!.stopped).toBe(1);
    expect(h.hub.channels()).toEqual([]);
  });
});
