import { VarType, type VarTypeId } from "./decoder";

/** Test helper: builds an irsdk header and matching var buffers from a small var list. */

export interface SyntheticVar {
  name: string;
  type: VarTypeId;
  count?: number;
}

const VAR_HEADER_OFFSET = 112;
const SIZE: Record<VarTypeId, number> = { 0: 1, 1: 1, 2: 4, 3: 4, 4: 4, 5: 8 };

export interface SyntheticLayout {
  header: Buffer;
  bufLen: number;
  /** Encode values (scalar or per-element arrays) into a var buffer; unset vars stay zero. */
  buffer(values: Record<string, number | number[]>): Buffer;
}

export function syntheticLayout(vars: SyntheticVar[]): SyntheticLayout {
  const offsets = new Map<string, { offset: number; type: VarTypeId; count: number }>();
  let offset = 0;
  for (const v of vars) {
    const count = v.count ?? 1;
    offsets.set(v.name, { offset, type: v.type, count });
    offset += SIZE[v.type] * count;
  }
  const bufLen = offset;
  const header = Buffer.alloc(VAR_HEADER_OFFSET + vars.length * 144);
  header.writeInt32LE(2, 0);
  header.writeInt32LE(60, 8);
  header.writeInt32LE(vars.length, 24);
  header.writeInt32LE(VAR_HEADER_OFFSET, 28);
  header.writeInt32LE(1, 32);
  header.writeInt32LE(bufLen, 36);
  vars.forEach((v, i) => {
    const at = VAR_HEADER_OFFSET + i * 144;
    const entry = offsets.get(v.name);
    header.writeInt32LE(v.type, at);
    header.writeInt32LE(entry?.offset ?? 0, at + 4);
    header.writeInt32LE(entry?.count ?? 1, at + 8);
    header.write(v.name, at + 16, 32, "latin1");
  });
  return {
    header,
    bufLen,
    buffer(values) {
      const out = Buffer.alloc(bufLen);
      for (const [name, value] of Object.entries(values)) {
        const entry = offsets.get(name);
        if (entry === undefined) throw new Error(`synthetic var ${name} not declared`);
        const list = Array.isArray(value) ? value : [value];
        list.forEach((x, i) => write(out, entry.type, entry.offset + i * SIZE[entry.type], x));
      }
      return out;
    },
  };
}

function write(buf: Buffer, type: VarTypeId, at: number, value: number): void {
  switch (type) {
    case VarType.Char:
    case VarType.Bool:
      buf.writeUInt8(value, at);
      break;
    case VarType.Int:
      buf.writeInt32LE(value, at);
      break;
    case VarType.Bitfield:
      buf.writeUInt32LE(value, at);
      break;
    case VarType.Float:
      buf.writeFloatLE(value, at);
      break;
    case VarType.Double:
      buf.writeDoubleLE(value, at);
      break;
  }
}
