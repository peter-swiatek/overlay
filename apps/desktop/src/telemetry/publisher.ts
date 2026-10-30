import type { TelemetryFrame } from "@overlay/sim-core";
import { clampRateHz, type TelemetryAck } from "../shared/telemetry-types";

/** The part of an Electron `MessagePortMain` the publisher uses. */
export interface PortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  start(): void;
}

/** With this many frames unacknowledged, newer frames wait and only the latest is kept. */
export const MAX_UNACKED = 2;

/** A send may come this much earlier than due, so timer jitter does not skip frames at 60 Hz. */
const SLACK_FRACTION = 0.25;
const MAX_SLACK_MS = 3;

class Subscriber {
  readonly intervalMs: number;
  private dueMs = Number.NEGATIVE_INFINITY;
  private unacked = new Set<number>();
  private pending: TelemetryFrame | undefined;
  closed = false;

  constructor(
    private readonly port: PortLike,
    readonly rateHz: number,
  ) {
    this.intervalMs = 1000 / rateHz;
  }

  offer(frame: TelemetryFrame, nowMs: number): void {
    if (this.closed) return;
    const slack = Math.min(MAX_SLACK_MS, this.intervalMs * SLACK_FRACTION);
    if (nowMs < this.dueMs - slack) return;
    this.dueMs =
      nowMs - this.dueMs > this.intervalMs ? nowMs + this.intervalMs : this.dueMs + this.intervalMs;
    if (this.unacked.size >= MAX_UNACKED) {
      this.pending = frame;
      return;
    }
    this.send(frame);
  }

  ack(seq: number): void {
    for (const sent of this.unacked) if (sent <= seq) this.unacked.delete(sent);
    const pending = this.pending;
    if (pending !== undefined && this.unacked.size < MAX_UNACKED) {
      this.pending = undefined;
      this.send(pending);
    }
  }

  private send(frame: TelemetryFrame): void {
    this.pending = undefined;
    this.unacked.add(frame.seq);
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

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  addSubscriber(port: PortLike, rateHz: number): void {
    const sub = new Subscriber(port, clampRateHz(rateHz));
    this.subscribers.add(sub);
    port.on("message", (event) => {
      const ack = asAck(event.data);
      if (ack) sub.ack(ack.seq);
    });
    port.on("close", () => {
      sub.closed = true;
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
