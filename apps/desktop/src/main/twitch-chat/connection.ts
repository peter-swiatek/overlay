/**
 * One read-only, anonymous connection to a Twitch channel's chat over Twitch's public IRC
 * WebSocket. It logs in as an anonymous "justinfan" user (no account, no token), asks for message
 * tags and moderation commands, joins the channel and only ever listens: the only lines it can
 * send are the log-in, the join and keep-alive pings and pongs.
 */
import {
  INITIAL_CHAT_STATE,
  MAX_KEPT_MESSAGES,
  TWITCH_IRC_URL,
  TWITCH_LOGIN_RE,
  applyChatEvent,
  chatEventOf,
  cleanText,
  nickOf,
  parseIrcLine,
  type ChatEvent,
  type ChatState,
  type ChatStatus,
  type IrcMessage,
} from "@overlay/overlays/twitch-chat";

/** Commands this client may send. Never PRIVMSG: the overlay does not write to the chat. */
const ALLOWED_COMMANDS: ReadonlySet<string> = new Set(["CAP", "NICK", "JOIN", "PING", "PONG"]);

/** Longest line handled; longer ones are skipped (Twitch lines stay well under this). */
export const MAX_LINE_LENGTH = 16_384;
/** No join this long after starting to connect: try again. */
export const CONNECT_TIMEOUT_MS = 20_000;
/** Twitch pings about every five minutes; after this long without any line we ping it. */
export const IDLE_MS = 6 * 60_000;
/** Our ping got no answer this long: the connection is dead. */
export const PONG_TIMEOUT_MS = 15_000;
/** Reconnect delays: first, then doubling up to the most, each with some jitter. */
export const RETRY_FIRST_MS = 1_000;
export const RETRY_MAX_MS = 60_000;

export interface SocketHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  /** Called once, when the socket closed or failed to open. */
  onClose(): void;
}

export interface ChatSocket {
  send(data: string): void;
  close(): void;
}

export type OpenSocket = (url: string, handlers: SocketHandlers) => ChatSocket;

export interface ChannelConnectionDeps {
  url: string;
  openSocket: OpenSocket;
  now(): number;
  /** 0 <= x < 1. */
  random(): number;
  /** Runs `fn` after `ms`; returns the cancel function. */
  setTimer(fn: () => void, ms: number): () => void;
}

/** Delay before reconnect attempt `attempt` (0 first): doubling, capped, 50-100 % jitter. */
export function retryDelayMs(attempt: number, random: number): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.min(attempt, 16));
  return Math.round(base * (0.5 + random / 2));
}

/** An anonymous read-only nick ("justinfan" plus five digits). */
export function anonymousNick(random: number): string {
  return `justinfan${10_000 + Math.floor(random * 90_000)}`;
}

/**
 * The chat server to use. A local test server can be named in the environment for development
 * builds only (never in a packaged app), and only on this computer.
 */
export function chatServerUrl(envValue: string | undefined, packaged: boolean): string {
  if (packaged || envValue === undefined || envValue === "") return TWITCH_IRC_URL;
  try {
    const url = new URL(envValue);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol === "ws:" || url.protocol === "wss:") && local) return url.href;
  } catch {
    // Fall through to the real server.
  }
  return TWITCH_IRC_URL;
}

/** Opens a socket with the WebSocket built into Node and Electron's main process. */
export const openWebSocket: OpenSocket = (url, handlers) => {
  const ws = new WebSocket(url);
  let closed = false;
  const closeOnce = (): void => {
    if (closed) return;
    closed = true;
    handlers.onClose();
  };
  ws.addEventListener("open", () => handlers.onOpen());
  ws.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data === "string") handlers.onMessage(event.data);
  });
  ws.addEventListener("close", closeOnce);
  ws.addEventListener("error", closeOnce);
  return {
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => {
      try {
        ws.close();
      } catch {
        // Already closing.
      }
    },
  };
};

/**
 * The connection to one channel: connects, joins, keeps the channel's recent messages, reconnects
 * with backoff when the link drops and reports every change through `onEvent`.
 */
export class ChannelConnection {
  private state: ChatState;
  private socket: ChatSocket | null = null;
  /** Bumped per socket, so late callbacks of an old one do nothing. */
  private generation = 0;
  private attempt = 0;
  private stopped = true;
  private nick = "";
  private nextLocalId = 0;
  private cancelConnectTimer: (() => void) | null = null;
  private cancelIdleTimer: (() => void) | null = null;
  private cancelPongTimer: (() => void) | null = null;
  private cancelRetry: (() => void) | null = null;

  constructor(
    readonly channel: string,
    private readonly deps: ChannelConnectionDeps,
    private readonly onEvent: (event: ChatEvent) => void,
  ) {
    if (!TWITCH_LOGIN_RE.test(channel) || channel !== channel.toLowerCase()) {
      throw new Error("ChannelConnection needs a lowercase Twitch login");
    }
    this.state = { ...INITIAL_CHAT_STATE, channel, status: { state: "idle", notice: null } };
  }

  /** The channel's status and recent messages, as a snapshot event. */
  snapshot(): ChatEvent & { type: "snapshot" } {
    return {
      type: "snapshot",
      channel: this.channel,
      status: this.state.status ?? { state: "idle", notice: null },
      messages: [...this.state.messages],
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  /** Disconnects for good (until started again). */
  stop(): void {
    this.stopped = true;
    this.generation++;
    this.clearTimers();
    this.cancelRetry?.();
    this.cancelRetry = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus({ state: "idle", notice: null });
  }

  private connect(): void {
    const generation = ++this.generation;
    this.setStatus({ state: this.attempt === 0 ? "connecting" : "reconnecting", notice: null });
    this.nick = anonymousNick(this.deps.random());
    const current = () => generation === this.generation && !this.stopped;
    this.socket = this.deps.openSocket(this.deps.url, {
      onOpen: () => {
        if (!current()) return;
        this.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
        this.send(`NICK ${this.nick}`);
        this.send(`JOIN #${this.channel}`);
        this.touch();
      },
      onMessage: (data) => {
        if (current()) this.receive(data);
      },
      onClose: () => {
        if (current()) this.dropped();
      },
    });
    this.cancelConnectTimer = this.deps.setTimer(() => {
      if (current()) this.reconnect();
    }, CONNECT_TIMEOUT_MS);
  }

  /** Sends one line, if it is one this read-only client may send. */
  private send(line: string): void {
    const command = line.split(" ", 1)[0] ?? "";
    if (!ALLOWED_COMMANDS.has(command) || /[\r\n]/.test(line)) return;
    this.socket?.send(`${line}\r\n`);
  }

  private receive(data: string): void {
    this.touch();
    for (const line of data.split(/\r?\n/)) {
      if (line === "" || line.length > MAX_LINE_LENGTH) continue;
      const msg = parseIrcLine(line);
      if (msg) this.handle(msg);
      if (this.socket === null) return;
    }
  }

  private handle(msg: IrcMessage): void {
    switch (msg.command) {
      case "PING":
        this.send(`PONG :${cleanText(msg.params[0] ?? "tmi.twitch.tv", 200)}`);
        return;
      case "RECONNECT":
        // Twitch is about to restart this server: move now, without waiting.
        this.attempt = 0;
        this.reconnect();
        return;
      case "JOIN":
        if (nickOf(msg.prefix) === this.nick) this.joined();
        return;
      case "ROOMSTATE":
        if (msg.params[0]?.toLowerCase() === `#${this.channel}`) this.joined();
        return;
      case "NOTICE": {
        const target = msg.params[0]?.toLowerCase();
        const text = cleanText(msg.params[1] ?? "", 200).trim();
        if ((target === `#${this.channel}` || target === "*") && text !== "") {
          this.setStatus({ state: this.state.status?.state ?? "connecting", notice: text });
        }
        return;
      }
      default: {
        const event = chatEventOf(msg, this.channel, this.deps.now(), () => {
          this.nextLocalId++;
          return `local-${this.nextLocalId}`;
        });
        if (event === null) return;
        const before = this.state;
        this.state = applyChatEvent(this.state, event, MAX_KEPT_MESSAGES);
        if (this.state !== before) this.onEvent(event);
      }
    }
  }

  private joined(): void {
    this.cancelConnectTimer?.();
    this.cancelConnectTimer = null;
    this.attempt = 0;
    if (this.state.status?.state !== "connected") {
      this.setStatus({ state: "connected", notice: this.state.status?.notice ?? null });
    }
  }

  /** Any line from the server: the link is alive; ping it again only after a quiet spell. */
  private touch(): void {
    this.cancelPongTimer?.();
    this.cancelPongTimer = null;
    this.cancelIdleTimer?.();
    const generation = this.generation;
    this.cancelIdleTimer = this.deps.setTimer(() => {
      if (generation !== this.generation || this.stopped) return;
      this.send("PING :tmi.twitch.tv");
      this.cancelPongTimer = this.deps.setTimer(() => {
        if (generation === this.generation && !this.stopped) this.reconnect();
      }, PONG_TIMEOUT_MS);
    }, IDLE_MS);
  }

  /** Closes the current socket and goes through the retry path. */
  private reconnect(): void {
    const socket = this.socket;
    this.generation++;
    this.socket = null;
    socket?.close();
    this.dropped();
  }

  private dropped(): void {
    this.socket = null;
    this.clearTimers();
    if (this.stopped) return;
    this.setStatus({ state: "reconnecting", notice: null });
    const delay = retryDelayMs(this.attempt, this.deps.random());
    this.attempt++;
    this.cancelRetry?.();
    this.cancelRetry = this.deps.setTimer(() => {
      this.cancelRetry = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  private clearTimers(): void {
    for (const cancel of [this.cancelConnectTimer, this.cancelIdleTimer, this.cancelPongTimer]) {
      cancel?.();
    }
    this.cancelConnectTimer = null;
    this.cancelIdleTimer = null;
    this.cancelPongTimer = null;
  }

  private setStatus(status: ChatStatus): void {
    const prev = this.state.status;
    if (prev?.state === status.state && prev.notice === status.notice) return;
    this.state = { ...this.state, status };
    this.onEvent({ type: "status", status });
  }
}
