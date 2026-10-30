/**
 * Fixture container format (".ovfx", version 1).
 *
 * A file is one gzip stream of records:
 *
 *   [u8 kind][u32 LE length][f64 LE monotonic ms][f64 LE wall-clock ms][payload]
 *
 * `length` is the payload length in bytes. The first record is always the JSON header.
 * Readers skip kinds they do not know, so new kinds can be added without a version bump.
 */

export const FIXTURE_FORMAT = "ovfx";
export const FIXTURE_VERSION = 1;
export const FIXTURE_EXTENSION = ".ovfx";

/** Bytes before the payload: kind (1) + length (4) + monotonic (8) + wall clock (8). */
export const RECORD_HEAD_BYTES = 21;

/** Record kinds are fixed; never renumber. */
export const RecordKind = {
  /** JSON {@link FixtureHeader}. */
  Header: 1,
  /** iRacing: raw irsdk header plus var headers, bytes [0, varHeaderOffset + numVars * 144). */
  IracingHeader: 2,
  /** iRacing: session info YAML, raw bytes. */
  IracingSessionYaml: 3,
  /** iRacing: u32 LE tickCount followed by the raw var buffer (bufLen bytes). */
  IracingVarBuffer: 4,
  /** LMU: the raw `LMU_Data` mapping bytes, unmodified. */
  LmuBuffer: 5,
  /** LMU: JSON sync metadata for the frame in the next LmuBuffer record. */
  LmuSync: 6,
  /** JSON {path, status, latencyMs, body}. */
  RestResponse: 7,
  /** JSON event marker {label, ...}. */
  Marker: 8,
  /** JSON end-of-file summary; absent in a truncated file. */
  Summary: 9,
} as const;

export type SimId = "iracing" | "lmu";

export interface FixtureHeader {
  format: typeof FIXTURE_FORMAT;
  version: number;
  sim: SimId;
  captureToolVersion: string;
  appVersion: string;
  os: string;
  startedUtc: string;
  notes: string;
  /** Extra stamped facts (mapping sizes, ...). Readers must ignore keys they do not know. */
  [key: string]: unknown;
}

export interface FixtureRecord {
  kind: number;
  monoMs: number;
  wallMs: number;
  payload: Buffer;
}

export function encodeRecord(
  kind: number,
  monoMs: number,
  wallMs: number,
  payload: Uint8Array,
): Buffer {
  const out = Buffer.allocUnsafe(RECORD_HEAD_BYTES + payload.length);
  out.writeUInt8(kind, 0);
  out.writeUInt32LE(payload.length, 1);
  out.writeDoubleLE(monoMs, 5);
  out.writeDoubleLE(wallMs, 13);
  out.set(payload, RECORD_HEAD_BYTES);
  return out;
}

export function toPayload(value: Uint8Array | string | object): Uint8Array {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return value;
  return Buffer.from(JSON.stringify(value), "utf8");
}

export function parseJsonPayload<T = unknown>(record: FixtureRecord): T {
  return JSON.parse(record.payload.toString("utf8")) as T;
}

/** `<sim>-<UTC timestamp>.ovfx`, e.g. `lmu-20261030T101500Z.ovfx`. `attempt` > 0 adds a suffix. */
export function fixtureFileName(sim: SimId, when: Date, attempt = 0): string {
  const stamp = when
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${sim}-${stamp}${attempt > 0 ? `-${attempt + 1}` : ""}${FIXTURE_EXTENSION}`;
}
