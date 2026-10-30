import { once } from "node:events";
import type { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants, createGzip, type Gzip } from "node:zlib";
import {
  FIXTURE_FORMAT,
  FIXTURE_VERSION,
  RecordKind,
  encodeRecord,
  toPayload,
  type FixtureHeader,
} from "./format";

export interface WriterClock {
  monoMs(): number;
  wallMs(): number;
}

export const DEFAULT_FLUSH_INTERVAL_MS = 1000;

export interface FixtureWriterOptions {
  clock: WriterClock;
  /** Gzip sync flush period. Default 1000 ms. */
  flushIntervalMs?: number;
  /** gzip level; default 6. */
  level?: number;
}

export type HeaderFields = Omit<FixtureHeader, "format" | "version">;

/**
 * Streaming, backpressure-aware writer. `write` resolves once the compressor has accepted the
 * record (after a drain when it asked us to wait). The gzip stream is sync-flushed every second
 * and on every marker, so a crash loses at most the last second.
 */
export class FixtureWriter {
  private readonly gzip: Gzip;
  private readonly done: Promise<void>;
  private readonly timer: NodeJS.Timeout;
  private failure: Error | undefined;
  private closed = false;
  private uncompressed = 0;
  private readonly counts: Record<number, number> = {};

  constructor(
    sink: Writable,
    header: HeaderFields,
    private readonly options: FixtureWriterOptions,
  ) {
    this.gzip = createGzip({ level: options.level ?? 6 });
    this.done = pipeline(this.gzip, sink).catch((error: unknown) => {
      this.failure = error instanceof Error ? error : new Error(String(error));
    });
    this.timer = setInterval(
      () => void this.flush(),
      options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    );
    this.timer.unref();
    const full = { ...header, format: FIXTURE_FORMAT, version: FIXTURE_VERSION } as FixtureHeader;
    this.append(RecordKind.Header, full);
  }

  get bytesUncompressed(): number {
    return this.uncompressed;
  }

  get recordCounts(): Readonly<Record<number, number>> {
    return this.counts;
  }

  private append(kind: number, payload: Uint8Array | string | object): boolean {
    const record = encodeRecord(
      kind,
      this.options.clock.monoMs(),
      this.options.clock.wallMs(),
      toPayload(payload),
    );
    this.uncompressed += record.length;
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    return this.gzip.write(record);
  }

  async write(kind: number, payload: Uint8Array | string | object): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error("FixtureWriter is closed");
    if (!this.append(kind, payload)) await once(this.gzip, "drain");
    if (kind === RecordKind.Marker) await this.flush();
  }

  /** Forces compressed bytes out so a crash or a reader sees everything written so far. */
  flush(): Promise<void> {
    if (this.closed || this.failure) return Promise.resolve();
    return new Promise((resolve) => {
      this.gzip.flush(constants.Z_SYNC_FLUSH, () => resolve());
    });
  }

  /** Writes the end-of-file summary, finishes the gzip stream and waits for the sink. */
  async close(summary: Record<string, unknown> = {}): Promise<void> {
    if (this.closed) return;
    clearInterval(this.timer);
    if (!this.failure) {
      this.append(RecordKind.Summary, {
        ...summary,
        recordCounts: { ...this.counts },
        bytesUncompressed: this.uncompressed,
      });
    }
    this.closed = true;
    this.gzip.end();
    await this.done;
    if (this.failure) throw this.failure;
  }
}
