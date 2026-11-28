import { describe, expect, it } from "vitest";
import { TWITCH_IRC_URL, type ChatEvent } from "@overlay/overlays/twitch-chat";
import {
  CONNECT_TIMEOUT_MS,
  ChannelConnection,
  IDLE_MS,
  PONG_TIMEOUT_MS,
  RETRY_MAX_MS,
  anonymousNick,
  chatServerUrl,
  retryDelayMs,
  type ChatSocket,
  type SocketHandlers,
} from "./connection";

interface FakeSocket extends ChatSocket {
  url: string;
  handlers: SocketHandlers;
  sent: string[];
  closed: boolean;
}

/** Fake sockets and a manual clock. */
function harness(channel = "some_channel") {
  const sockets: FakeSocket[] = [];
  let now = 1_700_000_000_000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;
  const events: ChatEvent[] = [];
  const conn = new ChannelConnection(
    channel,
    {
      url: "ws://127.0.0.1:9999",
      openSocket: (url, handlers) => {
        const s: FakeSocket = {
          url,
          handlers,
          sent: [],
          closed: false,
          send: (d) => s.sent.push(d),
          close: () => {
            s.closed = true;
          },
        };
        sockets.push(s);
        return s;
      },
      now: () => now,
      random: () => 0.5,
      setTimer: (fn, ms) => {
        const id = ++nextId;
        timers.push({ at: now + ms, fn, id });
        return () => {
          timers = timers.filter((t) => t.id !== id);
        };
      },
    },
    (e) => events.push(e),
  );
  const advance = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
    }
    now = end;
  };
  const last = () => sockets.at(-1)!;
  /** Opens the newest socket and has the server confirm the join. */
  const join = (): void => {
    last().handlers.onOpen();
    last().handlers.onMessage(`:tmi.twitch.tv ROOMSTATE #${channel}\r\n`);
  };
  const statuses = () => events.filter((e) => e.type === "status").map((e) => e.status.state);
  return { conn, sockets, events, advance, last, join, statuses, timerCount: () => timers.length };
}

describe("ChannelConnection", () => {
  it("logs in anonymously, asks for tags and commands, joins, and sends nothing else", () => {
    const h = harness();
    h.conn.start();
    expect(h.sockets).toHaveLength(1);
    expect(h.last().url).toBe("ws://127.0.0.1:9999");
    h.last().handlers.onOpen();
    expect(h.last().sent).toEqual([
      "CAP REQ :twitch.tv/tags twitch.tv/commands\r\n",
      "NICK justinfan55000\r\n",
      "JOIN #some_channel\r\n",
    ]);
    expect(h.last().sent.join("")).not.toMatch(/PASS|PRIVMSG|oauth/i);
    expect(h.statuses()).toEqual(["connecting"]);
  });

  it("is connected once the join is confirmed by JOIN or ROOMSTATE", () => {
    const h = harness();
    h.conn.start();
    h.last().handlers.onOpen();
    h.last().handlers.onMessage(":justinfan55000!justinfan55000@x JOIN #some_channel\r\n");
    expect(h.statuses()).toEqual(["connecting", "connected"]);
    expect(h.conn.snapshot().status.state).toBe("connected");
  });

  it("answers PING with PONG", () => {
    const h = harness();
    h.conn.start();
    h.join();
    h.last().handlers.onMessage("PING :tmi.twitch.tv\r\n");
    expect(h.last().sent.at(-1)).toBe("PONG :tmi.twitch.tv\r\n");
  });

  it("passes messages, timeouts, clears and deletions on and keeps them for a snapshot", () => {
    const h = harness();
    h.conn.start();
    h.join();
    h.last().handlers.onMessage(
      "@id=m-1;user-id=7;display-name=Apex_Otter;color=#FF0000 :apex_otter!a@x PRIVMSG #some_channel :hi\r\n" +
        "@id=m-2;user-id=8 :late_braker!l@x PRIVMSG #some_channel :hello\r\n" +
        "@id=m-3 :late_braker!l@x PRIVMSG #other_channel :elsewhere\r\n",
    );
    const snap = h.conn.snapshot();
    expect(snap.channel).toBe("some_channel");
    expect(snap.messages.map((m) => m.text)).toEqual(["hi", "hello"]);
    expect(snap.messages[0]).toMatchObject({ name: "Apex_Otter", color: "#ff0000", userId: "7" });
    h.last().handlers.onMessage(
      "@target-user-id=7 :tmi.twitch.tv CLEARCHAT #some_channel :apex_otter\r\n",
    );
    expect(h.conn.snapshot().messages.map((m) => m.id)).toEqual(["m-2"]);
    h.last().handlers.onMessage("@target-msg-id=m-2 :tmi.twitch.tv CLEARMSG #some_channel :x\r\n");
    expect(h.conn.snapshot().messages).toEqual([]);
    h.last().handlers.onMessage("@id=m-4 :a_b!a@x PRIVMSG #some_channel :again\r\n");
    h.last().handlers.onMessage(":tmi.twitch.tv CLEARCHAT #some_channel\r\n");
    expect(h.conn.snapshot().messages).toEqual([]);
    expect(h.events.filter((e) => e.type !== "status").map((e) => e.type)).toEqual([
      "message",
      "message",
      "clear-user",
      "delete",
      "message",
      "clear-all",
    ]);
  });

  it("passes Twitch's notices about the channel on as the status notice", () => {
    const h = harness();
    h.conn.start();
    h.join();
    h.last().handlers.onMessage(
      "@msg-id=msg_channel_suspended :tmi.twitch.tv NOTICE #some_channel :This channel does not exist or has been suspended.\r\n",
    );
    expect(h.conn.snapshot().status).toEqual({
      state: "connected",
      notice: "This channel does not exist or has been suspended.",
    });
    h.last().handlers.onMessage(":tmi.twitch.tv NOTICE #other :not ours\r\n");
    expect(h.conn.snapshot().status.notice).toMatch(/suspended/);
  });

  it("reconnects with growing delays after drops, and from the start after a join", () => {
    const h = harness();
    h.conn.start();
    h.last().handlers.onClose();
    expect(h.statuses().at(-1)).toBe("reconnecting");
    // random 0.5: 75 % of 1 s, then of 2 s.
    h.advance(749);
    expect(h.sockets).toHaveLength(1);
    h.advance(1);
    expect(h.sockets).toHaveLength(2);
    h.last().handlers.onClose();
    h.advance(1499);
    expect(h.sockets).toHaveLength(2);
    h.advance(1);
    expect(h.sockets).toHaveLength(3);
    h.join();
    h.last().handlers.onClose();
    h.advance(750);
    expect(h.sockets).toHaveLength(4);
  });

  it("retries when the join does not come in time", () => {
    const h = harness();
    h.conn.start();
    h.last().handlers.onOpen();
    h.advance(CONNECT_TIMEOUT_MS);
    expect(h.sockets[0]!.closed).toBe(true);
    h.advance(750);
    expect(h.sockets).toHaveLength(2);
  });

  it("pings after a quiet spell and reconnects when no answer comes", () => {
    const h = harness();
    h.conn.start();
    h.join();
    h.advance(IDLE_MS - 1);
    h.last().handlers.onMessage("@id=x :a_b!a@x PRIVMSG #some_channel :still here\r\n");
    h.advance(IDLE_MS - 1);
    expect(h.last().sent.some((l) => l.startsWith("PING"))).toBe(false);
    h.advance(1);
    expect(h.last().sent.at(-1)).toBe("PING :tmi.twitch.tv\r\n");
    h.last().handlers.onMessage(":tmi.twitch.tv PONG tmi.twitch.tv :tmi.twitch.tv\r\n");
    h.advance(PONG_TIMEOUT_MS);
    expect(h.sockets).toHaveLength(1);
    h.advance(IDLE_MS);
    h.advance(PONG_TIMEOUT_MS);
    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.statuses().at(-1)).toBe("reconnecting");
  });

  it("moves to a new socket at once on RECONNECT", () => {
    const h = harness();
    h.conn.start();
    h.join();
    h.last().handlers.onMessage(":tmi.twitch.tv RECONNECT\r\n");
    expect(h.sockets[0]!.closed).toBe(true);
    h.advance(750);
    expect(h.sockets).toHaveLength(2);
    h.join();
    // The old socket's late close does not start another one.
    h.sockets[0]!.handlers.onClose();
    h.advance(RETRY_MAX_MS);
    expect(h.sockets).toHaveLength(2);
  });

  it("stops for good: closes, cancels timers and ignores the old socket", () => {
    const h = harness();
    h.conn.start();
    h.join();
    h.conn.stop();
    expect(h.last().closed).toBe(true);
    expect(h.timerCount()).toBe(0);
    h.last().handlers.onMessage("@id=z :a_b!a@x PRIVMSG #some_channel :late\r\n");
    h.last().handlers.onClose();
    h.advance(RETRY_MAX_MS * 2);
    expect(h.sockets).toHaveLength(1);
    expect(h.conn.snapshot().messages).toEqual([]);
    expect(h.statuses().at(-1)).toBe("idle");
  });

  it("skips overlong and malformed lines", () => {
    const h = harness();
    h.conn.start();
    h.join();
    h.last().handlers.onMessage(
      `@id=big :a_b!a@x PRIVMSG #some_channel :${"x".repeat(20_000)}\r\n<garbage>\r\n\r\n`,
    );
    expect(h.conn.snapshot().messages).toEqual([]);
  });

  it("only accepts a lowercase login as its channel", () => {
    const h = () => harness("Bad Name");
    expect(h).toThrow();
    expect(() => harness("Some_Channel")).toThrow();
  });
});

describe("connection helpers", () => {
  it("backs off from 1 s to at most a minute, with jitter", () => {
    expect(retryDelayMs(0, 0)).toBe(500);
    expect(retryDelayMs(0, 0.999)).toBeLessThanOrEqual(1000);
    expect(retryDelayMs(3, 0.5)).toBe(6000);
    expect(retryDelayMs(30, 0.999)).toBeLessThanOrEqual(RETRY_MAX_MS);
  });

  it("makes anonymous justinfan nicks", () => {
    expect(anonymousNick(0)).toBe("justinfan10000");
    expect(anonymousNick(0.99999)).toMatch(/^justinfan\d{5}$/);
  });

  it("uses Twitch's server, or a local test server outside packaged builds only", () => {
    expect(chatServerUrl(undefined, false)).toBe(TWITCH_IRC_URL);
    expect(chatServerUrl("ws://127.0.0.1:6667", false)).toBe("ws://127.0.0.1:6667/");
    expect(chatServerUrl("ws://localhost:6667", false)).toBe("ws://localhost:6667/");
    expect(chatServerUrl("ws://127.0.0.1:6667", true)).toBe(TWITCH_IRC_URL);
    expect(chatServerUrl("wss://evil.example:443", false)).toBe(TWITCH_IRC_URL);
    expect(chatServerUrl("http://127.0.0.1:6667", false)).toBe(TWITCH_IRC_URL);
    expect(chatServerUrl("not a url", false)).toBe(TWITCH_IRC_URL);
  });
});
