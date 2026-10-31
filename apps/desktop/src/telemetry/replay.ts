import {
  fileSource,
  iracing,
  lmu,
  parseJsonPayload,
  RecordKind,
  ReplaySource,
  type ByteSourceFactory,
  type FixtureRecord,
} from "@overlay/sim-core";
import type { SourceFrame, TelemetrySource } from "./source";

/**
 * Turns fixture records into frames, one record at a time. Pure and synchronous, so the pacing
 * and the file reading stay out of the part whose speed we measure.
 */
export class ReplayRecordDecoder {
  private adapter: iracing.IracingAdapter | undefined;
  private info: iracing.IracingSessionInfo | null = null;
  private lmuDecoder = new lmu.LmuDecoder();
  private headers = 0;
  /** Session YAML texts parsed so far; tests use it to leave parses out of timings. */
  yamlParses = 0;

  /** The frame this record completes, if any. */
  accept(record: FixtureRecord): SourceFrame | null {
    switch (record.kind) {
      case RecordKind.Header:
        // The first header starts the replay; later ones are a looped file starting over.
        this.headers++;
        this.adapter = undefined;
        this.info = null;
        this.lmuDecoder = new lmu.LmuDecoder();
        return null;
      case RecordKind.IracingHeader:
        this.adapter = iracing.IracingAdapter.fromHeaderBytes(record.payload);
        return null;
      case RecordKind.IracingSessionYaml:
        this.yamlParses++;
        this.info = iracing.parseSessionYaml(iracing.decodeSessionYaml(record.payload));
        return null;
      case RecordKind.IracingVarBuffer:
        return this.iracingFrame(record);
      case RecordKind.RestResponse:
        this.lmuDecoder.observeRest(
          parseJsonPayload<{ path: string; status?: number; body: unknown }>(record),
        );
        return null;
      case RecordKind.LmuBuffer:
        return this.lmuFrame(record);
      default:
        return null;
    }
  }

  /** True once for the header that starts a second pass; the caller resets its calculators. */
  takeRestart(): boolean {
    const restart = this.headers > 1;
    if (restart) this.headers = 1;
    return restart;
  }

  private iracingFrame(record: FixtureRecord): SourceFrame | null {
    if (!this.adapter) return null;
    const state = this.adapter.toSimState(record.payload.subarray(4), this.info);
    state.source = "replay";
    return { state };
  }

  private lmuFrame(record: FixtureRecord): SourceFrame {
    const result = this.lmuDecoder.decode(record.payload);
    result.state.source = "replay";
    return { state: result.state, error: result.error };
  }
}

export interface ReplayOptions {
  speed?: number;
  loop?: boolean;
}

/** Plays a fixture file as frames. At speed 0 it runs as fast as the consumer reads. */
export class ReplayTelemetrySource implements TelemetrySource {
  readonly id = "replay";
  readonly pollIntervalMs = 0;
  ended = false;

  readonly decoder = new ReplayRecordDecoder();

  private constructor(
    private readonly iterator: AsyncIterator<FixtureRecord>,
    private readonly abortSignal: AbortController,
  ) {}

  static fromFile(path: string, options: ReplayOptions = {}): ReplayTelemetrySource {
    return ReplayTelemetrySource.fromBytes(fileSource(path), options);
  }

  static fromBytes(open: ByteSourceFactory, options: ReplayOptions = {}): ReplayTelemetrySource {
    const abort = new AbortController();
    const replay = new ReplaySource(open, {
      speed: options.speed ?? 1,
      loop: options.loop ?? true,
      signal: abort.signal,
    });
    return new ReplayTelemetrySource(replay[Symbol.asyncIterator](), abort);
  }

  /** Already-read records, played without pacing: for tests that must leave file IO out. */
  static fromRecords(records: readonly FixtureRecord[]): ReplayTelemetrySource {
    return new ReplayTelemetrySource(
      (async function* () {
        yield* records;
      })(),
      new AbortController(),
    );
  }

  async read(): Promise<SourceFrame | null> {
    while (!this.ended) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        return null;
      }
      const frame = this.decoder.accept(next.value);
      if (frame) return this.decoder.takeRestart() ? { ...frame, restart: true } : frame;
    }
    return null;
  }

  close(): void {
    this.abortSignal.abort();
    this.ended = true;
    void this.iterator.return?.();
  }
}
