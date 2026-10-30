import type { Writable } from "node:stream";
import {
  RecordKind,
  parseJsonPayload,
  type FixtureHeader,
  type FixtureRecord,
  type SimId,
} from "./format";
import { FixtureReader, type ByteSource } from "./reader";
import { LmuRedactor, redactIracingHeader, redactIracingYaml } from "./redact";
import { FixtureWriter, type HeaderFields } from "./writer";

export interface SliceOptions {
  /** Opens the source again for each pass; LMU needs two (name scan, then slicing). */
  openInput: () => ByteSource;
  output: Writable;
  /** Seconds after the first record's monoMs, inclusive. */
  fromS: number;
  /** Seconds after the first record's monoMs, exclusive. */
  toS: number;
  /** Name of the source file, stored in the slice header as `sliceOf`. */
  sourceName: string;
  /** Redact personal data (default true). Turn off only for private scratch slices. */
  redact?: boolean;
}

export interface SliceResult {
  sim: SimId;
  recordsWritten: number;
  /** Frames kept: iRacing var buffers or LMU sync/buffer pairs. */
  framesKept: number;
  firstFrameS: number | undefined;
  lastFrameS: number | undefined;
  /** Original names seen in LMU REST data (for the verification step; never print them). */
  redactedNames: string[];
}

/** Records that describe state decoders need before the first frame they see. */
function isStateKind(kind: number): boolean {
  return (
    kind === RecordKind.IracingHeader ||
    kind === RecordKind.IracingSessionYaml ||
    kind === RecordKind.RestResponse ||
    kind === RecordKind.Marker
  );
}

/** A settable clock for the writer: it stamps each record with the time we choose. */
class SettableClock {
  mono = 0;
  wall = 0;
  monoMs = (): number => this.mono;
  wallMs = (): number => this.wall;
  set(record: Pick<FixtureRecord, "monoMs" | "wallMs">): void {
    this.mono = record.monoMs;
    this.wall = record.wallMs;
  }
}

export async function sliceFixture(options: SliceOptions): Promise<SliceResult> {
  const redact = options.redact ?? true;
  const probe = new FixtureReader(options.openInput());
  const redactor = new LmuRedactor();
  if (redact) await scanLmuNames(probe, redactor);
  const header = probe.header;
  if (!header) throw new Error("Not a fixture file: no header record");

  const reader = new FixtureReader(options.openInput());
  const clock = new SettableClock();
  let writer: FixtureWriter | undefined;
  const latest = new Map<string, FixtureRecord>();
  let originMono: number | undefined;
  let primed = false;
  let pendingBuffer = false;
  let recordsWritten = 0;
  let framesKept = 0;
  let firstFrameS: number | undefined;
  let lastFrameS: number | undefined;
  let lastRecord: FixtureRecord | undefined;

  const out = async (kind: number, record: FixtureRecord, at: FixtureRecord): Promise<void> => {
    if (!writer) throw new Error("Slice writer not started");
    clock.set(at);
    await writer.write(kind, transform(kind, record.payload));
    recordsWritten++;
    lastRecord = at;
  };

  const transform = (kind: number, payload: Buffer): Buffer => {
    if (!redact) return payload;
    if (kind === RecordKind.IracingHeader) return redactIracingHeader(payload);
    if (kind === RecordKind.IracingSessionYaml) {
      return Buffer.from(redactIracingYaml(payload.toString("latin1")), "latin1");
    }
    if (kind === RecordKind.RestResponse) return redactor.redactRestPayload(payload);
    if (kind === RecordKind.LmuBuffer) return redactor.redactBuffer(payload);
    return payload;
  };

  const prime = async (at: FixtureRecord): Promise<void> => {
    primed = true;
    const order =
      header.sim === "lmu"
        ? [RecordKind.Marker, RecordKind.RestResponse]
        : [RecordKind.IracingHeader, RecordKind.IracingSessionYaml];
    for (const kind of order) {
      for (const [key, record] of latest) {
        if (key.startsWith(`${kind}:`)) await out(kind, record, at);
      }
    }
  };

  for await (const record of reader.records()) {
    if (originMono === undefined) {
      originMono = record.monoMs;
      clock.set(record);
      const fields = sliceHeader(header, options);
      writer = new FixtureWriter(options.output, fields, { clock });
      continue;
    }
    const relS = (record.monoMs - originMono) / 1000;
    const inWindow = relS >= options.fromS && relS < options.toS;

    if (record.kind === RecordKind.LmuBuffer && pendingBuffer) {
      pendingBuffer = false;
      await out(RecordKind.LmuBuffer, record, record);
      continue;
    }
    if (relS >= options.toS) {
      if (pendingBuffer) continue;
      break;
    }

    if (isStateKind(record.kind)) {
      latest.set(stateKey(record), record);
      if (!inWindow) continue;
      if (!primed) {
        await prime(record);
        continue;
      }
      await out(record.kind, record, record);
      continue;
    }
    if (!inWindow) continue;

    const isFrameStart =
      record.kind === RecordKind.IracingVarBuffer || record.kind === RecordKind.LmuSync;
    if (!primed) await prime(record);
    if (isFrameStart) {
      framesKept++;
      firstFrameS ??= relS;
      lastFrameS = relS;
    }
    if (record.kind === RecordKind.LmuSync) pendingBuffer = true;
    await out(record.kind, record, record);
  }

  if (!writer) throw new Error("Not a fixture file: no records");
  if (lastRecord) clock.set(lastRecord);
  await writer.close({
    sliceOf: options.sourceName,
    fromS: options.fromS,
    toS: options.toS,
    framesKept,
    redacted: redact,
  });
  return {
    sim: header.sim,
    recordsWritten,
    framesKept,
    firstFrameS,
    lastFrameS,
    redactedNames: redactor.originalNames(),
  };
}

function stateKey(record: FixtureRecord): string {
  if (record.kind === RecordKind.RestResponse) {
    return `${record.kind}:${parseJsonPayload<{ path: string }>(record).path}`;
  }
  return `${record.kind}:`;
}

function sliceHeader(source: FixtureHeader, options: SliceOptions): HeaderFields {
  const fields: Record<string, unknown> = { ...source };
  delete fields["format"];
  delete fields["version"];
  return {
    ...(fields as HeaderFields),
    sliceOf: options.sourceName,
    fromS: options.fromS,
    toS: options.toS,
  };
}

async function scanLmuNames(probe: FixtureReader, redactor: LmuRedactor): Promise<void> {
  for await (const record of probe.records()) {
    if (record.kind !== RecordKind.RestResponse) {
      if (probe.header && probe.header.sim !== "lmu") return;
      continue;
    }
    redactor.observe(parseJsonPayload<{ path: string; body: unknown }>(record));
  }
}
