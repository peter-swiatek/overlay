import { Readable, pipeline } from "node:stream";
import { constants, createGunzip } from "node:zlib";
import {
  FIXTURE_FORMAT,
  FIXTURE_VERSION,
  RECORD_HEAD_BYTES,
  RecordKind,
  parseJsonPayload,
  type FixtureHeader,
  type FixtureRecord,
} from "./format";

export type ByteSource = AsyncIterable<Uint8Array>;

/** Largest payload we accept; guards against garbage lengths in a damaged file. */
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;

/**
 * Streaming reader. Iterate `records()`; afterwards `truncated` tells whether the file ended
 * without its summary record or in the middle of a record (for example the game or the app
 * died while recording). Unknown record kinds are skipped.
 */
export class FixtureReader {
  header: FixtureHeader | undefined;
  summary: Record<string, unknown> | undefined;
  truncated = false;

  constructor(private readonly source: ByteSource) {}

  async *records(): AsyncGenerator<FixtureRecord> {
    const gunzip = createGunzip({ finishFlush: constants.Z_SYNC_FLUSH });
    pipeline(Readable.from(this.source), gunzip, () => {});
    let pending: Buffer = Buffer.alloc(0);
    let first = true;
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let offset = 0;
      while (pending.length - offset >= RECORD_HEAD_BYTES) {
        const length = pending.readUInt32LE(offset + 1);
        if (length > MAX_PAYLOAD_BYTES) throw new Error("Corrupt fixture: record too large");
        const end = offset + RECORD_HEAD_BYTES + length;
        if (pending.length < end) break;
        const record: FixtureRecord = {
          kind: pending.readUInt8(offset),
          monoMs: pending.readDoubleLE(offset + 5),
          wallMs: pending.readDoubleLE(offset + 13),
          payload: Buffer.from(pending.subarray(offset + RECORD_HEAD_BYTES, end)),
        };
        offset = end;
        if (first) {
          this.header = this.parseHeader(record);
          first = false;
        } else if (record.kind === RecordKind.Summary) {
          this.summary = parseJsonPayload<Record<string, unknown>>(record);
        }
        if (isKnownKind(record.kind)) yield record;
      }
      pending = pending.subarray(offset);
    }
    if (first) throw new Error("Not a fixture file: no header record");
    this.truncated = pending.length > 0 || this.summary === undefined;
  }

  private parseHeader(record: FixtureRecord): FixtureHeader {
    if (record.kind !== RecordKind.Header) throw new Error("Not a fixture file: bad first record");
    const header = parseJsonPayload<FixtureHeader>(record);
    if (header.format !== FIXTURE_FORMAT) throw new Error("Not a fixture file: bad format");
    if (header.version > FIXTURE_VERSION) {
      throw new Error(`Unsupported fixture version ${header.version}`);
    }
    return header;
  }
}

function isKnownKind(kind: number): boolean {
  return kind >= RecordKind.Header && kind <= RecordKind.Summary;
}

export async function readAllRecords(
  source: ByteSource,
): Promise<{ reader: FixtureReader; records: FixtureRecord[] }> {
  const reader = new FixtureReader(source);
  const records: FixtureRecord[] = [];
  for await (const record of reader.records()) records.push(record);
  return { reader, records };
}
