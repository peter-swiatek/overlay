import { crc32, gunzipSync, gzipSync } from "node:zlib";

/**
 * Tier 2 telemetry file (".otlm"): channel data of one session, kept for a limited time.
 *
 *   header   "OTLM" | u16 version | u16 reserved | u32 jsonLength | JSON (OtlmHeader)
 *   chunks   "CHNK" | u16 group | u16 reserved | u32 samples | u32 rawBytes | u32 gzipBytes
 *            | u32 crc32(gzip) | gzip(columns)
 *   footer   JSON (OtlmIndex) | u32 indexOffset | u32 jsonLength | "OTLF"      (optional)
 *
 * A group is a set of channels sampled together (the player at 60 Hz, the field at 4 Hz). A chunk
 * holds about ten seconds of one group as columns: for each channel, for each vector element,
 * all samples in time order. Integer channels are stored scaled (`round(value * scale)`), with the
 * type's minimum value standing for NaN, and optionally as differences between neighbouring
 * samples, which gzip then squeezes very well. All numbers are little-endian.
 *
 * Chunks are written one at a time and never rewritten, so a file cut short by a crash still
 * reads: the reader keeps every chunk that is complete and checksums right. The footer only
 * makes it quicker to find the chunks and tells the reader the file was closed properly.
 */
export const OTLM_FORMAT = "otlm";
export const OTLM_VERSION = 1;

const FILE_MAGIC = "OTLM";
const CHUNK_MAGIC = "CHNK";
const FOOTER_MAGIC = "OTLF";
const FILE_HEAD_BYTES = 12;
const CHUNK_HEAD_BYTES = 24;
const TRAILER_BYTES = 12;
/** Guards against garbage lengths in a damaged file. */
const MAX_HEADER_BYTES = 1 << 20;
const MAX_CHUNK_BYTES = 256 << 20;

export type OtlmType = "f32" | "f64" | "i8" | "i16" | "i32";

export interface OtlmChannel {
  name: string;
  unit: string;
  type: OtlmType;
  /** Integer types only: stored value is `round(value * scale)`. Default 1. */
  scale?: number;
  /** Integer types only: store the difference to the previous sample. */
  delta?: boolean;
  /** Values per sample (a vector, such as one entry per car). Default 1. */
  count?: number;
}

export interface OtlmGroup {
  id: string;
  /** Nominal (maximum) sample rate in Hz. */
  rateHz: number;
  /** Samples per chunk. */
  chunkSamples: number;
  channels: OtlmChannel[];
}

export interface OtlmHeader {
  format: typeof OTLM_FORMAT;
  version: number;
  sessionId: string;
  sim: string;
  /** Unix milliseconds. */
  startedAt: number;
  groups: OtlmGroup[];
  meta?: Record<string, string | number | null>;
}

export interface OtlmChunkIndexEntry {
  group: number;
  offset: number;
  samples: number;
  rawBytes: number;
  gzipBytes: number;
}

export interface OtlmIndex {
  chunks: OtlmChunkIndexEntry[];
}

export interface ByteSink {
  append(bytes: Uint8Array): void;
}

// ---- Column coding ----------------------------------------------------------------------------

interface IntLimits {
  min: number;
  max: number;
}

const INT_LIMITS: Record<"i8" | "i16" | "i32", IntLimits> = {
  i8: { min: -128, max: 127 },
  i16: { min: -32768, max: 32767 },
  i32: { min: -2147483648, max: 2147483647 },
};

const BYTES: Record<OtlmType, number> = { f32: 4, f64: 8, i8: 1, i16: 2, i32: 4 };

function count(channel: OtlmChannel): number {
  return channel.count ?? 1;
}

/** Values per row of a group (the sum of its channels' counts). */
export function rowWidth(group: OtlmGroup): number {
  return group.channels.reduce((sum, c) => sum + count(c), 0);
}

function wrap(type: "i8" | "i16" | "i32", value: number): number {
  if (type === "i8") return (value << 24) >> 24;
  if (type === "i16") return (value << 16) >> 16;
  return value | 0;
}

type IntArray = Int8Array | Int16Array | Int32Array;

type ColumnArray = Float32Array | Float64Array | IntArray;

function newColumn(type: OtlmType, n: number): ColumnArray {
  switch (type) {
    case "f32":
      return new Float32Array(n);
    case "f64":
      return new Float64Array(n);
    case "i8":
      return new Int8Array(n);
    case "i16":
      return new Int16Array(n);
    case "i32":
      return new Int32Array(n);
  }
}

/** Reads `n` values from a copy of the bytes, which makes any byte offset legal. */
function columnFrom(type: OtlmType, bytes: Uint8Array, n: number): ColumnArray {
  const copy = new Uint8Array(bytes);
  switch (type) {
    case "f32":
      return new Float32Array(copy.buffer, 0, n);
    case "f64":
      return new Float64Array(copy.buffer, 0, n);
    case "i8":
      return new Int8Array(copy.buffer, 0, n);
    case "i16":
      return new Int16Array(copy.buffer, 0, n);
    case "i32":
      return new Int32Array(copy.buffer, 0, n);
  }
}

/** Bytes of a chunk's columns once uncompressed. */
export function rawChunkBytes(group: OtlmGroup, samples: number): number {
  return group.channels.reduce((sum, c) => sum + BYTES[c.type] * count(c) * samples, 0);
}

function encodeColumns(group: OtlmGroup, rows: Float64Array, samples: number): Buffer {
  const width = rowWidth(group);
  const out = Buffer.alloc(rawChunkBytes(group, samples));
  let byteOffset = 0;
  let column = 0;
  for (const channel of group.channels) {
    for (let e = 0; e < count(channel); e++, column++) {
      const target = newColumn(channel.type, samples);
      if (channel.type === "f32" || channel.type === "f64") {
        for (let i = 0; i < samples; i++) target[i] = rows[i * width + column] ?? NaN;
      } else {
        encodeIntColumn(channel, channel.type, target as IntArray, rows, width, column, samples);
      }
      out.set(new Uint8Array(target.buffer, target.byteOffset, target.byteLength), byteOffset);
      byteOffset += target.byteLength;
    }
  }
  return out;
}

function encodeIntColumn(
  channel: OtlmChannel,
  type: "i8" | "i16" | "i32",
  target: IntArray,
  rows: Float64Array,
  width: number,
  column: number,
  samples: number,
): void {
  const { min, max } = INT_LIMITS[type];
  const scale = channel.scale ?? 1;
  let previous = 0;
  for (let i = 0; i < samples; i++) {
    const value = rows[i * width + column] ?? NaN;
    // The minimum value is reserved for NaN, so real values stop one above it.
    const stored = Number.isFinite(value)
      ? Math.min(max, Math.max(min + 1, Math.round(value * scale)))
      : min;
    target[i] = channel.delta === true ? stored - previous : stored;
    previous = stored;
  }
}

function decodeColumns(
  group: OtlmGroup,
  raw: Uint8Array,
  samples: number,
): Record<string, Float64Array> {
  const result: Record<string, Float64Array> = {};
  let byteOffset = 0;
  for (const channel of group.channels) {
    const k = count(channel);
    const values = new Float64Array(samples * k);
    for (let e = 0; e < k; e++) {
      const size = BYTES[channel.type] * samples;
      const source = columnFrom(channel.type, raw.subarray(byteOffset, byteOffset + size), samples);
      if (channel.type === "f32" || channel.type === "f64") {
        for (let i = 0; i < samples; i++) values[i * k + e] = source[i] ?? NaN;
      } else {
        decodeIntColumn(channel, channel.type, source as IntArray, values, k, e, samples);
      }
      byteOffset += size;
    }
    result[channel.name] = values;
  }
  return result;
}

function decodeIntColumn(
  channel: OtlmChannel,
  type: "i8" | "i16" | "i32",
  source: IntArray,
  values: Float64Array,
  k: number,
  e: number,
  samples: number,
): void {
  const scale = channel.scale ?? 1;
  const { min } = INT_LIMITS[type];
  let running = 0;
  for (let i = 0; i < samples; i++) {
    const stored = source[i] ?? 0;
    running = channel.delta === true ? wrap(type, running + stored) : stored;
    values[i * k + e] = running === min ? NaN : running / scale;
  }
}

function validateGroup(group: OtlmGroup): void {
  if (group.channels.length === 0) throw new Error(`Group ${group.id} has no channels`);
  if (!Number.isInteger(group.chunkSamples) || group.chunkSamples < 1) {
    throw new Error(`Group ${group.id} needs a positive chunkSamples`);
  }
  for (const c of group.channels) {
    if (!Number.isInteger(count(c)) || count(c) < 1) throw new Error(`Bad count on ${c.name}`);
    const isFloat = c.type === "f32" || c.type === "f64";
    if (isFloat && (c.scale !== undefined || c.delta === true)) {
      throw new Error(`Channel ${c.name}: scale and delta are for integer types`);
    }
  }
}

// ---- Writer -----------------------------------------------------------------------------------

interface GroupBuffer {
  group: OtlmGroup;
  width: number;
  rows: Float64Array;
  samples: number;
}

interface SealedChunk {
  groupIndex: number;
  rows: Float64Array;
  samples: number;
}

/**
 * Collects samples per group and writes them as chunks to a sink. `addSample` only copies numbers
 * into memory; the compression and the sink writes happen in `flush`, which the caller runs on a
 * timer, away from the tick path.
 */
export class OtlmWriter {
  private readonly buffers: GroupBuffer[];
  private sealed: SealedChunk[] = [];
  private readonly index: OtlmChunkIndexEntry[] = [];
  private offset = 0;
  private closed = false;

  constructor(
    private readonly sink: ByteSink,
    readonly header: OtlmHeader,
  ) {
    header.groups.forEach(validateGroup);
    this.buffers = header.groups.map((group) => {
      const width = rowWidth(group);
      return { group, width, rows: new Float64Array(width * group.chunkSamples), samples: 0 };
    });
    this.write(encodeHeader(header));
  }

  get bytesWritten(): number {
    return this.offset;
  }

  get chunkCount(): number {
    return this.index.length;
  }

  /** Samples held in memory that are not on the sink yet. */
  get pendingSamples(): number {
    return (
      this.buffers.reduce((n, b) => n + b.samples, 0) +
      this.sealed.reduce((n, c) => n + c.samples, 0)
    );
  }

  /** `values` is one row: the channels' values in order, vector channels' elements together. */
  addSample(groupId: string, values: ArrayLike<number>): void {
    if (this.closed) return;
    const buffer = this.buffers.find((b) => b.group.id === groupId);
    if (!buffer) throw new Error(`Unknown group ${groupId}`);
    if (values.length !== buffer.width) {
      throw new Error(`Group ${groupId} takes ${buffer.width} values, got ${values.length}`);
    }
    const base = buffer.samples * buffer.width;
    for (let i = 0; i < buffer.width; i++) buffer.rows[base + i] = values[i] as number;
    buffer.samples++;
    if (buffer.samples === buffer.group.chunkSamples) this.seal(buffer);
  }

  /** Writes every full chunk; with `partial`, also the samples of chunks still filling. */
  flush(partial = false): void {
    if (this.closed) return;
    if (partial) for (const b of this.buffers) if (b.samples > 0) this.seal(b);
    // A chunk leaves the queue only once it is on the sink, so a failed write is retried by the
    // next flush instead of losing the samples.
    for (let next = this.sealed[0]; next !== undefined; next = this.sealed[0]) {
      this.writeChunk(next);
      this.sealed.shift();
    }
  }

  /** Flushes everything and writes the footer. Safe to call twice. */
  close(): void {
    if (this.closed) return;
    this.flush(true);
    this.closed = true;
    this.write(encodeFooter({ chunks: this.index }, this.offset));
  }

  private seal(buffer: GroupBuffer): void {
    const groupIndex = this.buffers.indexOf(buffer);
    this.sealed.push({ groupIndex, rows: buffer.rows, samples: buffer.samples });
    buffer.rows = new Float64Array(buffer.width * buffer.group.chunkSamples);
    buffer.samples = 0;
  }

  private writeChunk(chunk: SealedChunk): void {
    const group = this.header.groups[chunk.groupIndex] as OtlmGroup;
    const raw = encodeColumns(group, chunk.rows, chunk.samples);
    const packed = gzipSync(raw, { level: 6 });
    const head = Buffer.alloc(CHUNK_HEAD_BYTES);
    head.write(CHUNK_MAGIC, 0, "ascii");
    head.writeUInt16LE(chunk.groupIndex, 4);
    head.writeUInt32LE(chunk.samples, 8);
    head.writeUInt32LE(raw.length, 12);
    head.writeUInt32LE(packed.length, 16);
    head.writeUInt32LE(crc32(packed), 20);
    const offset = this.offset;
    // One append per chunk, so a crash cannot leave a header without its payload except by a
    // torn write, which the checksum catches. The index only lists chunks that were written.
    this.write(Buffer.concat([head, packed]));
    this.index.push({
      group: chunk.groupIndex,
      offset,
      samples: chunk.samples,
      rawBytes: raw.length,
      gzipBytes: packed.length,
    });
  }

  private write(bytes: Uint8Array): void {
    this.sink.append(bytes);
    this.offset += bytes.length;
  }
}

function encodeHeader(header: OtlmHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const head = Buffer.alloc(FILE_HEAD_BYTES);
  head.write(FILE_MAGIC, 0, "ascii");
  head.writeUInt16LE(header.version, 4);
  head.writeUInt32LE(json.length, 8);
  return Buffer.concat([head, json]);
}

function encodeFooter(index: OtlmIndex, offset: number): Buffer {
  const json = Buffer.from(JSON.stringify(index), "utf8");
  const trailer = Buffer.alloc(TRAILER_BYTES);
  trailer.writeUInt32LE(offset, 0);
  trailer.writeUInt32LE(json.length, 4);
  trailer.write(FOOTER_MAGIC, 8, "ascii");
  return Buffer.concat([json, trailer]);
}

// ---- Reader -----------------------------------------------------------------------------------

export interface OtlmGroupData {
  id: string;
  rateHz: number;
  samples: number;
  /** Per channel: `samples * count` values, sample by sample (vector elements together). */
  channels: Record<string, Float64Array>;
}

export interface OtlmFile {
  header: OtlmHeader;
  groups: Record<string, OtlmGroupData>;
  chunks: number;
  /** The footer was found and agrees with the chunks: the file was closed properly. */
  complete: boolean;
  /** Bytes after the last good chunk that are not a valid footer (a torn write). */
  strayBytes: number;
}

/** Reads a whole file; a missing or damaged footer or a torn last chunk is tolerated. */
export function readOtlm(bytes: Uint8Array): OtlmFile {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { header, start } = parseHeader(data);
  const footer = parseFooter(data, start);
  const offsets = footer !== null ? footer.chunks.map((c) => c.offset) : null;

  const parts: { group: number; samples: number; columns: Record<string, Float64Array> }[] = [];
  let position = start;
  let next = 0;
  for (;;) {
    const at = offsets !== null ? offsets[next] : position;
    if (at === undefined) break;
    const chunk = parseChunk(data, at, header);
    if (chunk === null) break;
    parts.push({ group: chunk.group, samples: chunk.samples, columns: chunk.columns });
    position = chunk.end;
    next++;
  }

  const complete = footer !== null && next === footer.chunks.length;
  const end = complete && footer !== null ? footerStart(data) : position;
  return {
    header,
    groups: assemble(header, parts),
    chunks: parts.length,
    complete,
    strayBytes: complete ? 0 : Math.max(0, data.length - end),
  };
}

function parseHeader(data: Buffer): { header: OtlmHeader; start: number } {
  if (data.length < FILE_HEAD_BYTES || data.toString("ascii", 0, 4) !== FILE_MAGIC) {
    throw new Error("Not an OTLM file");
  }
  const version = data.readUInt16LE(4);
  if (version > OTLM_VERSION) throw new Error(`Unsupported OTLM version ${version}`);
  const length = data.readUInt32LE(8);
  if (length > MAX_HEADER_BYTES || data.length < FILE_HEAD_BYTES + length) {
    throw new Error("OTLM header is cut short");
  }
  const parsed: unknown = JSON.parse(
    data.toString("utf8", FILE_HEAD_BYTES, FILE_HEAD_BYTES + length),
  );
  if (!isHeader(parsed)) throw new Error("OTLM header is malformed");
  return { header: parsed, start: FILE_HEAD_BYTES + length };
}

function isHeader(value: unknown): value is OtlmHeader {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<OtlmHeader>;
  return v.format === OTLM_FORMAT && Array.isArray(v.groups) && typeof v.sessionId === "string";
}

function footerStart(data: Buffer): number {
  const jsonLength = data.readUInt32LE(data.length - TRAILER_BYTES + 4);
  return data.length - TRAILER_BYTES - jsonLength;
}

/** The index when the file ends with a well-formed footer. */
function parseFooter(data: Buffer, minStart: number): OtlmIndex | null {
  if (data.length < minStart + TRAILER_BYTES) return null;
  if (data.toString("ascii", data.length - 4) !== FOOTER_MAGIC) return null;
  const offset = data.readUInt32LE(data.length - TRAILER_BYTES);
  const jsonLength = data.readUInt32LE(data.length - TRAILER_BYTES + 4);
  const jsonStart = data.length - TRAILER_BYTES - jsonLength;
  if (jsonStart < minStart || offset !== jsonStart) return null;
  try {
    const parsed = JSON.parse(
      data.toString("utf8", jsonStart, jsonStart + jsonLength),
    ) as OtlmIndex;
    return Array.isArray(parsed.chunks) ? parsed : null;
  } catch {
    return null;
  }
}

interface ParsedChunk {
  group: number;
  samples: number;
  columns: Record<string, Float64Array>;
  end: number;
}

function parseChunk(data: Buffer, at: number, header: OtlmHeader): ParsedChunk | null {
  if (at < 0 || data.length < at + CHUNK_HEAD_BYTES) return null;
  if (data.toString("ascii", at, at + 4) !== CHUNK_MAGIC) return null;
  const groupIndex = data.readUInt16LE(at + 4);
  const samples = data.readUInt32LE(at + 8);
  const rawBytes = data.readUInt32LE(at + 12);
  const gzipBytes = data.readUInt32LE(at + 16);
  const checksum = data.readUInt32LE(at + 20);
  const group = header.groups[groupIndex];
  if (!group || rawBytes > MAX_CHUNK_BYTES || gzipBytes > MAX_CHUNK_BYTES) return null;
  const end = at + CHUNK_HEAD_BYTES + gzipBytes;
  if (data.length < end) return null;
  const packed = data.subarray(at + CHUNK_HEAD_BYTES, end);
  if (crc32(packed) !== checksum) return null;
  try {
    const raw = gunzipSync(packed);
    if (raw.length !== rawBytes || raw.length !== rawChunkBytes(group, samples)) return null;
    return { group: groupIndex, samples, columns: decodeColumns(group, raw, samples), end };
  } catch {
    return null;
  }
}

function assemble(
  header: OtlmHeader,
  parts: { group: number; samples: number; columns: Record<string, Float64Array> }[],
): Record<string, OtlmGroupData> {
  const groups: Record<string, OtlmGroupData> = {};
  header.groups.forEach((group, index) => {
    const mine = parts.filter((p) => p.group === index);
    const samples = mine.reduce((n, p) => n + p.samples, 0);
    const channels: Record<string, Float64Array> = {};
    for (const channel of group.channels) {
      const out = new Float64Array(samples * count(channel));
      let at = 0;
      for (const part of mine) {
        const column = part.columns[channel.name] as Float64Array;
        out.set(column, at);
        at += column.length;
      }
      channels[channel.name] = out;
    }
    groups[group.id] = { id: group.id, rateHz: group.rateHz, samples, channels };
  });
  return groups;
}
