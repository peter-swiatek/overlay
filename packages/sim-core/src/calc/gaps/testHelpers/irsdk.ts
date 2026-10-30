import { createReadStream } from "node:fs";
import { FixtureReader, RecordKind } from "../../../fixtures";

/** Minimal throwaway irsdk decoder for local-recording checks. Not production code. */

const VAR_HEADER_BYTES = 144;

export interface IrVar {
  name: string;
  type: number;
  offset: number;
  count: number;
}

export function parseVarHeaders(header: Buffer): Map<string, IrVar> {
  const numVars = header.readInt32LE(24);
  const varHeaderOffset = header.readInt32LE(28);
  const vars = new Map<string, IrVar>();
  for (let i = 0; i < numVars; i++) {
    const at = varHeaderOffset + i * VAR_HEADER_BYTES;
    const raw = header.subarray(at + 16, at + 48);
    const end = raw.indexOf(0);
    const name = raw.subarray(0, end < 0 ? 32 : end).toString("latin1");
    vars.set(name, {
      name,
      type: header.readInt32LE(at),
      offset: header.readInt32LE(at + 4),
      count: header.readInt32LE(at + 8),
    });
  }
  return vars;
}

/** Read element `index` of a var (int 2/bitfield 3, float 4, double 5, bool 1) from a var buffer. */
export function readVar(buf: Buffer, v: IrVar, index = 0): number {
  switch (v.type) {
    case 1:
      return buf.readUInt8(v.offset + index);
    case 2:
    case 3:
      return buf.readInt32LE(v.offset + index * 4);
    case 4:
      return buf.readFloatLE(v.offset + index * 4);
    case 5:
      return buf.readDoubleLE(v.offset + index * 8);
    default:
      throw new Error(`unsupported irsdk type ${v.type} for ${v.name}`);
  }
}

export interface IrSample {
  tick: number;
  /** Var buffer (without the u32 tick). */
  buf: Buffer;
}

export interface IrStream {
  vars: Map<string, IrVar>;
  yaml: string;
  samples: AsyncGenerator<IrSample>;
}

/** Streams var buffers from an iRacing .ovfx. The YAML is the first session record seen. */
export async function openIracing(path: string): Promise<IrStream> {
  const reader = new FixtureReader(createReadStream(path));
  const iterator = reader.records();
  let vars: Map<string, IrVar> | undefined;
  let yaml = "";
  const pending: IrSample[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error("recording has no var buffers");
    const record = next.value;
    if (record.kind === RecordKind.IracingHeader) vars = parseVarHeaders(record.payload);
    else if (record.kind === RecordKind.IracingSessionYaml && yaml === "")
      yaml = record.payload.toString("utf8");
    else if (record.kind === RecordKind.IracingVarBuffer) {
      pending.push({ tick: record.payload.readUInt32LE(0), buf: record.payload.subarray(4) });
      break;
    }
  }
  if (!vars) throw new Error("recording has no irsdk header");
  async function* samples(): AsyncGenerator<IrSample> {
    yield* pending;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      if (next.value.kind === RecordKind.IracingVarBuffer) {
        yield { tick: next.value.payload.readUInt32LE(0), buf: next.value.payload.subarray(4) };
      }
    }
  }
  return { vars, yaml, samples: samples() };
}
