/**
 * Twitch Chat for the overlay windows: one connection per distinct channel, shared by every
 * instance that shows it, open only while at least one such window is open. Each window gets its
 * own channel's events and nothing else.
 */
import type { ChatEvent } from "@overlay/overlays/twitch-chat";

/** An open Twitch Chat overlay window. */
export interface ChatWatcher {
  /** Overlay instance id. */
  id: string;
  /** The channel from its stored settings (validated), or null when none is set. */
  channel: string | null;
  /** Delivers an event to the window. */
  send(event: ChatEvent): void;
}

export interface HubConnection {
  start(): void;
  stop(): void;
  snapshot(): ChatEvent & { type: "snapshot" };
}

export type CreateConnection = (
  channel: string,
  onEvent: (event: ChatEvent) => void,
) => HubConnection;

const NO_CHANNEL: ChatEvent = {
  type: "snapshot",
  channel: null,
  status: { state: "idle", notice: null },
  messages: [],
};

export class TwitchChatHub {
  private readonly watchers = new Map<string, ChatWatcher>();
  private readonly connections = new Map<string, HubConnection>();

  constructor(private readonly createConnection: CreateConnection) {}

  /**
   * Makes the open windows `watchers`: connects to channels newly needed, disconnects from those
   * no window shows any more, and sends a window whose channel changed that channel's snapshot.
   */
  sync(watchers: readonly ChatWatcher[]): void {
    const previous = new Map(this.watchers);
    this.watchers.clear();
    for (const w of watchers) this.watchers.set(w.id, w);
    const wanted = new Set<string>();
    for (const w of this.watchers.values()) if (w.channel !== null) wanted.add(w.channel);
    for (const [channel, connection] of this.connections) {
      if (!wanted.has(channel)) {
        this.connections.delete(channel);
        connection.stop();
      }
    }
    for (const channel of wanted) {
      if (this.connections.has(channel)) continue;
      const connection = this.createConnection(channel, (event) => this.forward(channel, event));
      this.connections.set(channel, connection);
      connection.start();
    }
    for (const w of this.watchers.values()) {
      const before = previous.get(w.id);
      if (before === undefined || before.channel !== w.channel) this.sendSnapshot(w);
    }
  }

  /** A window (re)loaded and asks for everything so far. */
  hello(id: string): void {
    const w = this.watchers.get(id);
    if (w) this.sendSnapshot(w);
  }

  /** Channels connected now, for tests and diagnostics. */
  channels(): string[] {
    return [...this.connections.keys()];
  }

  stopAll(): void {
    this.sync([]);
  }

  private sendSnapshot(w: ChatWatcher): void {
    const connection = w.channel === null ? undefined : this.connections.get(w.channel);
    w.send(connection ? connection.snapshot() : NO_CHANNEL);
  }

  private forward(channel: string, event: ChatEvent): void {
    for (const w of this.watchers.values()) if (w.channel === channel) w.send(event);
  }
}
