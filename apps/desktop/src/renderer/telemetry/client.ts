import type { TelemetryFrame } from "@overlay/sim-core/types";
import type { TelemetryAck } from "../../shared/telemetry-types";

/** The part of a `MessagePort` the client uses. */
export interface ClientPort {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface PortMessageEvent {
  source: unknown;
  data: unknown;
  ports: readonly ClientPort[];
}

export interface ClientEnv {
  /** The page's own window: only messages posted by it are trusted (the preload posts them). */
  self: unknown;
  /** Listens for page messages; returns the remover. */
  listen(handler: (event: PortMessageEvent) => void): () => void;
  /** `overlayApi.subscribeTelemetry`. */
  requestSubscribe(rateHz: number): void;
  nowMs(): number;
  /** Schedules `fn`; returns a function that cancels it. */
  setTimer(fn: () => void, ms: number): () => void;
}

/** No frame for this long means the stream is stale (the process is stuck or restarting). */
export const STALE_AFTER_MS = 2000;

/** `stale` is true once frames have stopped arriving; `frame` is then the last one received. */
export type Selector<T> = (frame: TelemetryFrame | null, stale: boolean) => T;

interface Subscriber {
  selector: Selector<unknown>;
  onValue: (value: unknown) => void;
  intervalMs: number;
  lastMs: number;
  value: unknown;
  hasValue: boolean;
  /** Cancels the pending trailing update, if any. */
  cancelTrailing: (() => void) | undefined;
}

/** A send may come this much earlier than due, so timer jitter does not skip frames at 60 Hz. */
const MAX_SLACK_MS = 3;

/**
 * One telemetry connection per window. Holds the newest frame, acknowledges every frame it
 * stores and lets any number of hooks follow it, each at its own rate.
 */
export class TelemetryClient {
  private port: ClientPort | undefined;
  private frame: TelemetryFrame | null = null;
  private readonly subscribers = new Set<Subscriber>();
  private requestedHz = 0;
  private stale = false;
  private cancelStale: (() => void) | undefined;

  constructor(private readonly env: ClientEnv) {
    // Listen before anything asks for a port, so the first one cannot be missed.
    env.listen((event) => this.onWindowMessage(event));
  }

  /** The newest frame, or null before the first one. */
  latest(): TelemetryFrame | null {
    return this.frame;
  }

  /** True when frames have stopped arriving. */
  isStale(): boolean {
    return this.stale;
  }

  /**
   * Calls `onValue` with `selector(frame, stale)` at most `rateHz` times a second, and only when the
   * value changed (structural compare). Returns the unsubscribe function.
   */
  select<T>(selector: Selector<T>, rateHz: number, onValue: (value: T) => void): () => void {
    const sub: Subscriber = {
      selector,
      onValue: onValue as (value: unknown) => void,
      intervalMs: 1000 / Math.max(1, rateHz),
      lastMs: Number.NEGATIVE_INFINITY,
      value: undefined,
      hasValue: false,
      cancelTrailing: undefined,
    };
    this.subscribers.add(sub);
    if (this.frame) this.deliver(sub, true);
    // Only a higher rate than before needs a new port; the old one keeps serving until it arrives.
    if (rateHz > this.requestedHz) {
      this.requestedHz = rateHz;
      this.env.requestSubscribe(rateHz);
    }
    return () => {
      sub.cancelTrailing?.();
      this.subscribers.delete(sub);
    };
  }

  private onWindowMessage(event: PortMessageEvent): void {
    if (event.source !== this.env.self) return;
    const data = event.data as { type?: unknown } | null;
    if (typeof data !== "object" || data === null || data.type !== "telemetry-port") return;
    const port = event.ports[0];
    if (port) this.attach(port);
  }

  private attach(port: ClientPort): void {
    const old = this.port;
    this.port = port;
    port.onmessage = (event) => this.onFrame(port, event.data);
    old?.close();
  }

  private onFrame(from: ClientPort, data: unknown): void {
    if (from !== this.port || !isFrame(data)) return;
    // seq restarts at 1 when the telemetry process restarts, so a lower seq is not stale.
    this.frame = data;
    this.stale = false;
    this.cancelStale?.();
    this.cancelStale = this.env.setTimer(() => {
      this.stale = true;
      for (const sub of this.subscribers) this.deliver(sub, true);
    }, STALE_AFTER_MS);
    const ack: TelemetryAck = { type: "ack", seq: data.seq };
    from.postMessage(ack);
    for (const sub of this.subscribers) this.deliver(sub, false);
  }

  /** Delivers now, or (when throttled) schedules one trailing update so the last change lands. */
  private deliver(sub: Subscriber, force: boolean): void {
    const nowMs = this.env.nowMs();
    const slack = Math.min(MAX_SLACK_MS, sub.intervalMs / 4);
    const waitMs = sub.intervalMs - slack - (nowMs - sub.lastMs);
    if (!force && waitMs > 0) {
      sub.cancelTrailing ??= this.env.setTimer(() => this.deliver(sub, true), waitMs);
      return;
    }
    sub.cancelTrailing?.();
    sub.cancelTrailing = undefined;
    sub.lastMs = nowMs;
    const next = sub.selector(this.frame, this.stale);
    if (sub.hasValue && structurallyEqual(sub.value, next)) return;
    sub.value = next;
    sub.hasValue = true;
    sub.onValue(next);
  }
}

const STATUSES: ReadonlySet<unknown> = new Set(["live", "waiting", "error"]);

/** Checks the fields the overlays read; the sender is our own telemetry process. */
export function isFrame(data: unknown): data is TelemetryFrame {
  if (typeof data !== "object" || data === null) return false;
  const f = data as Partial<Record<keyof TelemetryFrame, unknown>>;
  return (
    typeof f.seq === "number" &&
    STATUSES.has(f.status) &&
    typeof f.state === "object" &&
    f.state !== null &&
    typeof f.derived === "object" &&
    f.derived !== null
  );
}

export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      structurallyEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
