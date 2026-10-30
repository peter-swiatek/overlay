import type { TelemetryFrame } from "@overlay/sim-core";
import { clampRateHz, type TelemetryAck } from "../shared/telemetry-types";

/** The part of an Electron `MessagePortMain` the publisher uses. */
export interface PortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  start(): void;
}

/** Handles a subscriber's message that is not an ack. */
export type RequestHandler = (data: unknown, reply: (message: unknown) => void) => void;

/** With this many frames unacknowledged, newer frames wait and only the latest is kept. */
export const MAX_UNACKED = 2;

/** A send may come this much earlier than due, so timer jitter does not skip frames at 60 Hz. */
const SLACK_FRACTION = 0.25;
const MAX_SLACK_MS = 3;

class Subscriber {
  readonly intervalMs: number;
  private dueMs = Number.NEGATIVE_INFINITY;
  private unacked = new Set<number>();
  /** Newest frame that must still be sent: held back by the rate window or by unacked frames. */
  private pending: TelemetryFrame | undefined;
  /** True when `pending` waits for an ack (rather than for the rate window). */
  private blockedByAcks = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private delivered: { status: string; error: string | null } | undefined;
  closed = false;

  constructor(
    private readonly port: PortLike,
    readonly rateHz: number,
    private readonly now: () => number,
  ) {
    this.intervalMs = 1000 / rateHz;
  }

  offer(frame: TelemetryFrame, nowMs: number): void {
    if (this.closed) return;
    // A change of status or error (waiting, error, live again) is never thrown away by the rate
    // limit: it may be the last frame for a long time.
    const changed =
      this.delivered?.status !== frame.status || this.delivered?.error !== frame.error;
    const slack = Math.min(MAX_SLACK_MS, this.intervalMs * SLACK_FRACTION);
    if (!changed && nowMs < this.dueMs - slack) {
      this.hold(frame, nowMs);
      return;
    }
    this.dueMs =
      nowMs - this.dueMs > this.intervalMs ? nowMs + this.intervalMs : this.dueMs + this.intervalMs;
    this.sendOrWait(frame);
  }

  ack(seq: number): void {
    for (const sent of this.unacked) if (sent <= seq) this.unacked.delete(sent);
    const pending = this.pending;
    if (pending !== undefined && this.blockedByAcks && this.unacked.size < MAX_UNACKED) {
      this.send(pending);
    }
  }

  /** A message that is not a frame: sent now, outside the rate and ack accounting. */
  reply(message: unknown): void {
    if (!this.closed) this.port.postMessage(message);
  }

  dispose(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.pending = undefined;
  }

  /** Keeps the newest throttled frame and sends it when the rate window opens. */
  private hold(frame: TelemetryFrame, nowMs: number): void {
    this.pending = frame;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        const held = this.pending;
        if (held !== undefined && !this.closed) this.offer(held, this.now());
      },
      Math.max(0, this.dueMs - nowMs),
    );
  }

  private sendOrWait(frame: TelemetryFrame): void {
    if (this.unacked.size >= MAX_UNACKED) {
      this.pending = frame;
      this.blockedByAcks = true;
      return;
    }
    this.send(frame);
  }

  private send(frame: TelemetryFrame): void {
    this.pending = undefined;
    this.blockedByAcks = false;
    this.unacked.add(frame.seq);
    this.delivered = { status: frame.status, error: frame.error };
    this.port.postMessage(frame);
  }
}

/**
 * Sends frames to subscribers over message ports. Each subscriber gets at most `rateHz` frames a
 * second (1 to 60) and acknowledges every seq it has handled. A subscriber with two or more
 * frames unacknowledged is slow (or gone), so frames for it collapse to the latest one, which is
 * sent as soon as an ack frees a slot: a slow overlay never builds a queue and never delays
 * another subscriber.
 */
export class TelemetryPublisher {
  private readonly subscribers = new Set<Subscriber>();

  /** `now` is the clock the deferred sends use; it must be the one that `publish` gets times from. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * `onRequest` gets every message that is not an ack, with a `reply` that answers on the same
   * port at once: replies are not frames, so they skip the rate limit and the ack window.
   */
  addSubscriber(port: PortLike, rateHz: number, onRequest?: RequestHandler): void {
    const sub = new Subscriber(port, clampRateHz(rateHz), this.now);
    this.subscribers.add(sub);
    port.on("message", (event) => {
      const ack = asAck(event.data);
      if (ack) sub.ack(ack.seq);
      else if (onRequest) onRequest(event.data, (reply) => sub.reply(reply));
    });
    port.on("close", () => {
      sub.dispose();
      this.subscribers.delete(sub);
    });
    port.start();
  }

  publish(frame: TelemetryFrame, nowMs: number): void {
    for (const sub of this.subscribers) sub.offer(frame, nowMs);
  }
}

function asAck(data: unknown): TelemetryAck | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { type, seq } = data as Partial<TelemetryAck>;
  return type === "ack" && typeof seq === "number" ? { type, seq } : undefined;
}
