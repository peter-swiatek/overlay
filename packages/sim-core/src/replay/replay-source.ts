import { createReadStream } from "node:fs";
import { RecordKind, type FixtureHeader, type FixtureRecord } from "../fixtures/format";
import { FixtureReader, type ByteSource } from "../fixtures/reader";

export interface ReplayOptions {
  /** Playback speed factor: 1 = real time, 2 = twice as fast, 0 = as fast as possible. */
  speed?: number;
  /**
   * Seconds after the first data record (the one after the header) to start at. State records
   * that precede the seek point (iRacing header and YAML, LMU REST and markers; latest of each)
   * are still delivered first, unpaced, so a decoder starts with full context.
   */
  startAtS?: number;
  /** Start over when the file ends, until the signal aborts or the consumer stops. */
  loop?: boolean;
  /** Ends iteration, also while it waits for the next record. */
  signal?: AbortSignal;
}

/** Opens the bytes of a fixture; called once per pass so that looping can start again. */
export type ByteSourceFactory = () => ByteSource;

export function fileSource(path: string): ByteSourceFactory {
  return () => createReadStream(path);
}

/**
 * Plays a fixture back as raw records. The header record is always the first record of a pass
 * and is delivered unpaced; a looping source delivers it again at the start of each pass, which
 * decoders should treat as a reset. Records are paced by their monotonic timestamps.
 */
export class ReplaySource implements AsyncIterable<FixtureRecord> {
  /** Header of the most recent pass; set once the first record has been read. */
  header: FixtureHeader | undefined;

  private readonly speed: number;
  private readonly startAtS: number;
  private readonly loop: boolean;
  private readonly signal: AbortSignal | undefined;

  constructor(
    private readonly open: ByteSourceFactory,
    options: ReplayOptions = {},
  ) {
    this.speed = options.speed ?? 1;
    this.startAtS = options.startAtS ?? 0;
    this.loop = options.loop ?? false;
    this.signal = options.signal;
    if (!(this.speed >= 0) || !Number.isFinite(this.speed)) {
      throw new RangeError("ReplaySource speed must be a finite number >= 0");
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<FixtureRecord> {
    do {
      let delivered = 0;
      for await (const record of this.pass()) {
        delivered++;
        yield record;
      }
      // An empty file would otherwise spin forever when looping at full speed.
      if (delivered <= 1) return;
    } while (this.loop && !this.signal?.aborted);
  }

  private async *pass(): AsyncGenerator<FixtureRecord> {
    const reader = new FixtureReader(this.open());
    const pending = new Map<string, FixtureRecord>();
    let origin: number | undefined;
    let seeking = this.startAtS > 0;
    let skipBuffer = false;
    let pacing: { base: number; startedAt: number } | undefined;
    let isHeader = true;

    for await (const record of reader.records()) {
      if (this.signal?.aborted) return;
      if (isHeader) {
        isHeader = false;
        this.header = reader.header;
        yield record;
        continue;
      }
      origin ??= record.monoMs;
      if (skipBuffer && record.kind === RecordKind.LmuBuffer) {
        skipBuffer = false;
        continue;
      }
      if (seeking) {
        if ((record.monoMs - origin) / 1000 < this.startAtS) {
          if (isStateRecord(record.kind)) pending.set(stateKey(record), record);
          if (record.kind === RecordKind.LmuSync) skipBuffer = true;
          continue;
        }
        seeking = false;
        for (const state of pending.values()) yield state;
      }
      if (this.speed > 0) {
        pacing ??= { base: record.monoMs, startedAt: Date.now() };
        const dueMs = (record.monoMs - pacing.base) / this.speed;
        const waitMs = pacing.startedAt + dueMs - Date.now();
        if (waitMs > 0 && !(await sleep(waitMs, this.signal))) return;
      }
      yield record;
    }
  }
}

function isStateRecord(kind: number): boolean {
  return (
    kind === RecordKind.IracingHeader ||
    kind === RecordKind.IracingSessionYaml ||
    kind === RecordKind.RestResponse ||
    kind === RecordKind.Marker
  );
}

/** One slot per kind; REST responses get one per path. */
function stateKey(record: FixtureRecord): string {
  if (record.kind !== RecordKind.RestResponse) return String(record.kind);
  const path = (JSON.parse(record.payload.toString("utf8")) as { path?: unknown }).path;
  return `${record.kind}:${typeof path === "string" ? path : ""}`;
}

/** Resolves true after `ms`, or false when the signal aborts first. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
