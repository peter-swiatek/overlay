import { iracing } from "@overlay/sim-core";

type SessionInfo = iracing.IracingSessionInfo;

/**
 * Parses iRacing session YAML off the sampling path: a parse takes tens of milliseconds, far over
 * the budget of a 60 Hz tick. `latest()` keeps returning the previous result until the next one
 * is ready.
 */
export interface SessionParser {
  /** Starts parsing `bytes` (raw YAML area, Windows-1252). A newer request replaces a queued one. */
  request(bytes: Uint8Array): void;
  /** The most recent completed parse, or null. */
  latest(): SessionInfo | null;
  /** Forget results and queued work; a parse still running is ignored when it finishes. */
  reset(): void;
  close(): void;
}

export type SessionJob = { id: number; bytes: Uint8Array };
export type SessionJobResult = { id: number; info: SessionInfo } | { id: number; error: string };

/** The work of one job; shared by the worker thread and the in-process parser. */
export function runSessionJob(job: SessionJob): SessionJobResult {
  try {
    return { id: job.id, info: iracing.parseSessionYaml(iracing.decodeSessionYaml(job.bytes)) };
  } catch (error) {
    return { id: job.id, error: String(error) };
  }
}

/** The slice of `worker_threads.Worker` the parser needs, so tests can fake it. */
export interface WorkerLike {
  postMessage(message: SessionJob): void;
  on(event: "message", listener: (result: SessionJobResult) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  terminate(): unknown;
}

/** A parse that takes longer than this is considered hung and its worker is replaced. */
export const PARSE_TIMEOUT_MS = 2000;
/** Tries per YAML text after worker failures, so a crashing worker cannot loop forever. */
const MAX_ATTEMPTS = 3;

export class WorkerSessionParser implements SessionParser {
  private worker: WorkerLike | undefined;
  private info: SessionInfo | null = null;
  private nextId = 1;
  /** Id of the job whose result is wanted; older results are stale. */
  private wantedId = 0;
  private running = false;
  /** The text being parsed, kept so a failed worker can be retried. */
  private current: Uint8Array | undefined;
  private attempts = 0;
  private queued: Uint8Array | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Last parse error or timeout, for diagnostics. */
  lastError: string | null = null;

  constructor(
    private readonly spawn: () => WorkerLike,
    private readonly timeoutMs = PARSE_TIMEOUT_MS,
  ) {}

  request(bytes: Uint8Array): void {
    if (this.running) {
      this.queued = bytes;
      return;
    }
    this.attempts = 0;
    this.dispatch(bytes);
  }

  latest(): SessionInfo | null {
    return this.info;
  }

  reset(): void {
    this.info = null;
    this.queued = undefined;
    this.current = undefined;
    this.wantedId = 0;
    this.running = false;
    clearTimeout(this.timer);
  }

  close(): void {
    this.reset();
    this.dropWorker();
  }

  private dropWorker(): void {
    void this.worker?.terminate();
    this.worker = undefined;
  }

  private dispatch(bytes: Uint8Array): void {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    this.wantedId = id;
    this.running = true;
    this.current = bytes;
    this.attempts++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onFailure(id, "parse timed out"), this.timeoutMs);
    // A copy: the caller reuses its buffer, and the worker needs its own to transfer or clone.
    worker.postMessage({ id, bytes: Uint8Array.from(bytes) });
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.spawn();
    worker.on("message", (result) => this.onResult(result));
    worker.on("error", (error) => {
      if (this.worker === worker) this.onFailure(this.wantedId, error.message);
    });
    this.worker = worker;
    return worker;
  }

  /** The worker hung or died: replace it and run the newest text again (a limited number of times). */
  private onFailure(id: number, message: string): void {
    if (id !== this.wantedId || !this.running) return;
    this.lastError = message;
    clearTimeout(this.timer);
    this.dropWorker();
    this.running = false;
    const retry = this.queued ?? (this.attempts < MAX_ATTEMPTS ? this.current : undefined);
    this.queued = undefined;
    if (retry === undefined) return;
    if (retry !== this.current) this.attempts = 0;
    this.dispatch(retry);
  }

  private onResult(result: SessionJobResult): void {
    if (result.id !== this.wantedId) return; // stale: from before a reset or a replaced worker
    clearTimeout(this.timer);
    this.running = false;
    if ("info" in result) this.info = result.info;
    else this.lastError = result.error;
    const queued = this.queued;
    this.queued = undefined;
    if (queued !== undefined) {
      this.attempts = 0;
      this.dispatch(queued);
    }
  }
}

/** Parses on the calling thread. For tests and the replay source, where a pause is harmless. */
export class InlineSessionParser implements SessionParser {
  private info: SessionInfo | null = null;
  request(bytes: Uint8Array): void {
    const result = runSessionJob({ id: 0, bytes });
    if ("info" in result) this.info = result.info;
  }
  latest(): SessionInfo | null {
    return this.info;
  }
  reset(): void {
    this.info = null;
  }
  close(): void {}
}
