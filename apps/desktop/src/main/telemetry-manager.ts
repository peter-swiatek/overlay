import { clampRateHz, type TelemetryCommand, type TelemetryEvent } from "../shared/telemetry-types";
import type { TelemetrySettings, TelemetrySettingsStorage } from "./telemetry-settings";

/** The part of Electron's `UtilityProcess` the manager uses. */
export interface TelemetryChild {
  postMessage(message: TelemetryCommand, transfer?: unknown[]): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: () => void): unknown;
  kill(): unknown;
}

export interface MessageChannel {
  port1: unknown;
  port2: unknown;
}

export interface TelemetryManagerDeps {
  /** Forks `telemetry.js` (serviceName "overlay-telemetry"). */
  fork(): TelemetryChild;
  /** A `MessageChannelMain`. */
  createChannel(): MessageChannel;
  /** Sends `port` to the renderer behind `sender` on the `telemetry:port` channel. */
  postPortToRenderer(sender: object, port: unknown): void;
  /** True when `sender` is one of the overlay windows. */
  isOverlaySender(sender: object): boolean;
  /** Schedules `fn`; returns a function that cancels it. */
  setTimer(fn: () => void, ms: number): () => void;
  nowMs(): number;
  onSettingsChange?: (settings: TelemetrySettings) => void;
  /** Called on every status message from the child (not on exit). */
  onStatusChange?: (status: TelemetryEvent) => void;
}

/** How long quitting waits for the telemetry process to finish writing. */
export const SHUTDOWN_WAIT_MS = 3000;
export const RESTART_BASE_MS = 500;
export const RESTART_MAX_MS = 10_000;
/** A process must stay up this long before its next crash restarts without extra delay. */
export const STABLE_UPTIME_MS = 10_000;

export function restartDelayMs(attempt: number): number {
  return Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** attempt);
}

/**
 * Runs the telemetry utility process and hands each overlay window one MessagePort to it.
 *
 * A window has one port, at the highest rate any hook in it asked for. Main cannot close a port
 * it has transferred: when a window closes or its renderer drops a port, the publisher in the
 * telemetry process sees `close`, so the manager only forgets its record of the window.
 */
export class TelemetryManager {
  private child: TelemetryChild | undefined;
  private settings: TelemetrySettings;
  private status: TelemetryEvent | undefined;
  /** Rate (Hz) of the newest port brokered to each window (or asked for, while no child runs). */
  private readonly rates = new Map<object, number>();
  private quitting = false;
  private restartAttempt = 0;
  private startedAtMs = 0;
  private cancelRestart: (() => void) | undefined;
  /** Resolvers waiting for a child to exit (see `shutdown`). */
  private readonly exitWaiters = new Map<TelemetryChild, () => void>();

  constructor(
    private readonly store: TelemetrySettingsStorage,
    private readonly deps: TelemetryManagerDeps,
  ) {
    this.settings = store.load();
  }

  getSettings(): TelemetrySettings {
    return this.settings;
  }

  getStatus(): TelemetryEvent | undefined {
    return this.status;
  }

  get isRunning(): boolean {
    return this.child !== undefined;
  }

  start(): void {
    if (this.child || this.quitting) return;
    const child = this.deps.fork();
    this.child = child;
    this.startedAtMs = this.deps.nowMs();
    child.on("message", (message) => {
      if (this.child !== child || !isStatusEvent(message)) return;
      this.status = message;
      this.deps.onStatusChange?.(message);
    });
    child.on("exit", () => {
      this.exitWaiters.get(child)?.();
      this.onExit(child);
    });
    this.sendSource();
    for (const [sender, rate] of this.rates) this.broker(sender, rate);
  }

  /**
   * Sends `stop` and turns restarts off. Call on app quit. The returned promise settles when the
   * process has exited (it writes its last rows and closes its files first) or, failing that,
   * after `timeoutMs`, when the process is killed.
   */
  shutdown(timeoutMs = SHUTDOWN_WAIT_MS): Promise<void> {
    this.quitting = true;
    this.cancelRestart?.();
    this.cancelRestart = undefined;
    const child = this.child;
    this.child = undefined;
    if (!child) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const cancelTimer = this.deps.setTimer(() => {
        this.exitWaiters.delete(child);
        child.kill();
        resolve();
      }, timeoutMs);
      this.exitWaiters.set(child, () => {
        cancelTimer();
        this.exitWaiters.delete(child);
        resolve();
      });
      child.postMessage({ type: "stop" });
    });
  }

  updateSettings(patch: unknown): TelemetrySettings {
    this.settings = this.store.update(patch);
    this.sendSource();
    this.deps.onSettingsChange?.(this.settings);
    return this.settings;
  }

  /**
   * IPC entry point for `telemetry:subscribe`. Ignores senders that are not overlay windows.
   * Returns true when a new port was brokered.
   */
  handleSubscribe(sender: object, rateHz: unknown): boolean {
    if (!this.deps.isOverlaySender(sender)) return false;
    return this.subscribe(sender, rateHz);
  }

  /** A higher rate than the window already has brokers a new port; a lower or equal one does not. */
  subscribe(sender: object, rateHz: unknown): boolean {
    if (this.quitting) return false;
    const rate = clampRateHz(rateHz);
    const current = this.rates.get(sender);
    if (current !== undefined && rate <= current) return false;
    this.rates.set(sender, rate);
    return this.broker(sender, rate);
  }

  /** The page is loading again (or its renderer died): its old ports and rate are void. */
  forgetWindow(sender: object): void {
    this.rates.delete(sender);
  }

  private broker(sender: object, rate: number): boolean {
    const child = this.child;
    if (!child) return false;
    const { port1, port2 } = this.deps.createChannel();
    child.postMessage({ type: "subscribe", rateHz: rate }, [port1]);
    this.deps.postPortToRenderer(sender, port2);
    return true;
  }

  private sendSource(): void {
    const { source, replayPath, replaySpeed } = this.settings;
    this.child?.postMessage({
      type: "setSource",
      source,
      ...(replayPath !== null ? { replayPath } : {}),
      replaySpeed,
    });
  }

  private onExit(child: TelemetryChild): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.status = undefined;
    if (this.quitting) return;
    if (this.deps.nowMs() - this.startedAtMs >= STABLE_UPTIME_MS) this.restartAttempt = 0;
    const delay = restartDelayMs(this.restartAttempt);
    this.restartAttempt += 1;
    this.cancelRestart = this.deps.setTimer(() => {
      this.cancelRestart = undefined;
      this.start();
    }, delay);
  }
}

function isStatusEvent(message: unknown): message is TelemetryEvent {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "status"
  );
}
