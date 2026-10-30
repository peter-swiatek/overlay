/**
 * Pure-bytes decoder for the iRacing irsdk memory map: the header and variable table (as stored
 * in fixture record kind 2, or read from live shared memory) and the var buffers (kind 4 payload
 * after its u32 tick, or one live buffer). No Electron, no native code.
 *
 * Header (little endian): ver@0, status@4, tickRate@8, sessionInfoUpdate@12, sessionInfoLen@16,
 * sessionInfoOffset@20, numVars@24, varHeaderOffset@28, numBuf@32, bufLen@36.
 * Var header (144 bytes): type i32@0, offset i32@4, count i32@8, name char[32]@16.
 */

export const VarType = {
  Char: 0,
  Bool: 1,
  Int: 2,
  Bitfield: 3,
  Float: 4,
  Double: 5,
} as const;

export type VarTypeId = (typeof VarType)[keyof typeof VarType];

const VAR_HEADER_BYTES = 144;
const NAME_OFFSET = 16;
const NAME_BYTES = 32;
const MIN_HEADER_BYTES = 40;

const TYPE_SIZE: Record<VarTypeId, number> = {
  [VarType.Char]: 1,
  [VarType.Bool]: 1,
  [VarType.Int]: 4,
  [VarType.Bitfield]: 4,
  [VarType.Float]: 4,
  [VarType.Double]: 8,
};

export interface VarInfo {
  name: string;
  type: VarTypeId;
  /** Byte offset inside the var buffer (not counting the fixture's leading tick). */
  offset: number;
  /** Element count: 1 for a scalar, 72 for CarIdx* arrays in current recordings. */
  count: number;
}

export interface IrsdkHeader {
  version: number;
  status: number;
  tickRate: number;
  sessionInfoUpdate: number;
  sessionInfoLength: number;
  sessionInfoOffset: number;
  numVars: number;
  varHeaderOffset: number;
  numBuf: number;
  bufLen: number;
}

function isVarType(value: number): value is VarTypeId {
  return value >= VarType.Char && value <= VarType.Double;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function parseIrsdkHeader(bytes: Uint8Array): IrsdkHeader {
  if (bytes.length < MIN_HEADER_BYTES) throw new Error("irsdk header too short");
  const v = viewOf(bytes);
  return {
    version: v.getInt32(0, true),
    status: v.getInt32(4, true),
    tickRate: v.getInt32(8, true),
    sessionInfoUpdate: v.getInt32(12, true),
    sessionInfoLength: v.getInt32(16, true),
    sessionInfoOffset: v.getInt32(20, true),
    numVars: v.getInt32(24, true),
    varHeaderOffset: v.getInt32(28, true),
    numBuf: v.getInt32(32, true),
    bufLen: v.getInt32(36, true),
  };
}

function readName(bytes: Uint8Array, start: number): string {
  let end = start;
  const limit = start + NAME_BYTES;
  while (end < limit && bytes[end] !== 0) end++;
  return String.fromCharCode(...bytes.subarray(start, end));
}

export class IracingDecoder {
  readonly header: IrsdkHeader;
  readonly vars: ReadonlyMap<string, VarInfo>;

  private constructor(header: IrsdkHeader, vars: Map<string, VarInfo>) {
    this.header = header;
    this.vars = vars;
  }

  /** Parse the header and var table from bytes [0, varHeaderOffset + numVars * 144) or more. */
  static fromHeaderBytes(bytes: Uint8Array): IracingDecoder {
    const header = parseIrsdkHeader(bytes);
    const { numVars, varHeaderOffset } = header;
    if (numVars < 0 || varHeaderOffset < 0) throw new Error("irsdk header: bad var table");
    if (bytes.length < varHeaderOffset + numVars * VAR_HEADER_BYTES) {
      throw new Error("irsdk header: var table is cut off");
    }
    const v = viewOf(bytes);
    const vars = new Map<string, VarInfo>();
    for (let i = 0; i < numVars; i++) {
      const at = varHeaderOffset + i * VAR_HEADER_BYTES;
      const type = v.getInt32(at, true);
      if (!isVarType(type)) continue;
      const name = readName(bytes, at + NAME_OFFSET);
      vars.set(name, {
        name,
        type,
        offset: v.getInt32(at + 4, true),
        count: v.getInt32(at + 8, true),
      });
    }
    return new IracingDecoder(header, vars);
  }

  /** The live session YAML stored in the header area, as text; null when absent. */
  sessionInfoText(headerBytes: Uint8Array): string | null {
    const { sessionInfoOffset: start, sessionInfoLength: len } = this.header;
    if (start <= 0 || len <= 0 || headerBytes.length < start + len) return null;
    const raw = headerBytes.subarray(start, start + len);
    const end = raw.indexOf(0);
    return Buffer.from(end < 0 ? raw : raw.subarray(0, end)).toString("latin1");
  }

  has(name: string): boolean {
    return this.vars.has(name);
  }

  /** Wrap one var buffer for reading. */
  reader(buffer: Uint8Array): VarReader {
    return new VarReader(this.vars, buffer);
  }
}

/** Typed reads from one var buffer. Missing vars or out-of-range reads give null / []. */
export class VarReader {
  private readonly view: DataView;

  constructor(
    private readonly vars: ReadonlyMap<string, VarInfo>,
    private readonly buffer: Uint8Array,
  ) {
    this.view = viewOf(buffer);
  }

  info(name: string): VarInfo | undefined {
    return this.vars.get(name);
  }

  /** Element `index` as a number (bool as 0/1, char as its code, bitfield as unsigned). */
  number(name: string, index = 0): number | null {
    const info = this.vars.get(name);
    if (info === undefined || index < 0 || index >= info.count) return null;
    const value = this.read(info, index);
    return Number.isFinite(value) ? value : null;
  }

  bool(name: string, index = 0): boolean | null {
    const value = this.number(name, index);
    return value === null ? null : value !== 0;
  }

  /** All elements; a scalar gives a one-element array. */
  numbers(name: string): number[] {
    const info = this.vars.get(name);
    if (info === undefined) return [];
    const out = new Array<number>(info.count);
    for (let i = 0; i < info.count; i++) out[i] = this.read(info, i);
    return out;
  }

  /** A char[] var as text up to the first NUL. */
  text(name: string): string | null {
    const info = this.vars.get(name);
    if (info === undefined || info.type !== VarType.Char) return null;
    const end = info.offset + info.count;
    if (end > this.buffer.length) return null;
    return (
      Buffer.from(this.buffer.subarray(info.offset, end)).toString("latin1").split("\0")[0] ?? ""
    );
  }

  private read(info: VarInfo, index: number): number {
    const at = info.offset + index * TYPE_SIZE[info.type];
    if (at + TYPE_SIZE[info.type] > this.buffer.length) return Number.NaN;
    switch (info.type) {
      case VarType.Char:
      case VarType.Bool:
        return this.view.getUint8(at);
      case VarType.Int:
        return this.view.getInt32(at, true);
      case VarType.Bitfield:
        return this.view.getUint32(at, true);
      case VarType.Float:
        return this.view.getFloat32(at, true);
      case VarType.Double:
        return this.view.getFloat64(at, true);
    }
  }
}
