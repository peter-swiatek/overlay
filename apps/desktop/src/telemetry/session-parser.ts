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

export class WorkerSessionParser implements SessionParser {
  private worker: WorkerLike | undefined;
  private info: SessionInfo | null = null;
  private nextId = 1;
  /** Id of the job whose result is wanted; older results are stale. */
  private wantedId = 0;
  private running = false;
  private queued: Uint8Array | undefined;
  /** Last parse error, for diagnostics. */
  lastError: string | null = null;

  constructor(private readonly spawn: () => WorkerLike) {}

  request(bytes: Uint8Array): void {
    if (this.running) {
      this.queued = bytes;
      return;
    }
    this.dispatch(bytes);
  }

  latest(): SessionInfo | null {
    return this.info;
  }

  reset(): void {
    this.info = null;
    this.queued = undefined;
    this.wantedId = 0;
  }

  close(): void {
    this.reset();
    void this.worker?.terminate();
    this.worker = undefined;
    this.running = false;
  }

  private dispatch(bytes: Uint8Array): void {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    this.wantedId = id;
    this.running = true;
    // A copy: the caller reuses its buffer, and the worker needs its own to transfer or clone.
    worker.postMessage({ id, bytes: Uint8Array.from(bytes) });
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.spawn();
    worker.on("message", (result) => this.onResult(result));
    worker.on("error", (error) => {
      this.lastError = error.message;
      this.worker = undefined;
      this.running = false;
    });
    this.worker = worker;
    return worker;
  }

  private onResult(result: SessionJobResult): void {
    this.running = false;
    if ("info" in result) {
      if (result.id === this.wantedId) this.info = result.info;
    } else {
      this.lastError = result.error;
    }
    const queued = this.queued;
    this.queued = undefined;
    if (queued !== undefined) this.dispatch(queued);
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
