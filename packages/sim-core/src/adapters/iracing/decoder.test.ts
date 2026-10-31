import { describe, expect, it } from "vitest";
import { IracingDecoder, VarType, type VarTypeId } from "./decoder";

interface VarSpec {
  name: string;
  type: VarTypeId;
  offset: number;
  count: number;
}

const VAR_HEADER_OFFSET = 112;

/** Builds irsdk header + var table bytes the way the sim lays them out. */
function buildHeader(specs: VarSpec[], bufLen: number, update = 7): Buffer {
  const bytes = Buffer.alloc(VAR_HEADER_OFFSET + specs.length * 144);
  bytes.writeInt32LE(2, 0);
  bytes.writeInt32LE(1, 4);
  bytes.writeInt32LE(60, 8);
  bytes.writeInt32LE(update, 12);
  bytes.writeInt32LE(0, 16);
  bytes.writeInt32LE(0, 20);
  bytes.writeInt32LE(specs.length, 24);
  bytes.writeInt32LE(VAR_HEADER_OFFSET, 28);
  bytes.writeInt32LE(3, 32);
  bytes.writeInt32LE(bufLen, 36);
  specs.forEach((spec, i) => {
    const at = VAR_HEADER_OFFSET + i * 144;
    bytes.writeInt32LE(spec.type, at);
    bytes.writeInt32LE(spec.offset, at + 4);
    bytes.writeInt32LE(spec.count, at + 8);
    bytes.write(spec.name, at + 16, 32, "latin1");
  });
  return bytes;
}

const SPECS: VarSpec[] = [
  { name: "SessionTime", type: VarType.Double, offset: 0, count: 1 },
  { name: "SessionNum", type: VarType.Int, offset: 8, count: 1 },
  { name: "SessionFlags", type: VarType.Bitfield, offset: 12, count: 1 },
  { name: "Throttle", type: VarType.Float, offset: 16, count: 1 },
  { name: "IsOnTrack", type: VarType.Bool, offset: 20, count: 1 },
  { name: "CarIdxLapDistPct", type: VarType.Float, offset: 24, count: 4 },
  { name: "CarIdxPosition", type: VarType.Int, offset: 40, count: 4 },
  { name: "CarIdxOnPitRoad", type: VarType.Bool, offset: 56, count: 4 },
  { name: "Tag", type: VarType.Char, offset: 60, count: 8 },
];
const BUF_LEN = 68;

function buildBuffer(): Buffer {
  const b = Buffer.alloc(BUF_LEN);
  b.writeDoubleLE(1234.5, 0);
  b.writeInt32LE(-3, 8);
  b.writeUInt32LE(0x80000004, 12); // top bit set: must read as unsigned
  b.writeFloatLE(0.25, 16);
  b.writeUInt8(1, 20);
  [0.5, 0.75, -1, 1].forEach((v, i) => b.writeFloatLE(v, 24 + i * 4));
  [3, 0, -1, 7].forEach((v, i) => b.writeInt32LE(v, 40 + i * 4));
  [1, 0, 0, 1].forEach((v, i) => b.writeUInt8(v, 56 + i));
  b.write("ABC\0junk", 60, "latin1");
  return b;
}

describe("IracingDecoder", () => {
  const decoder = IracingDecoder.fromHeaderBytes(buildHeader(SPECS, BUF_LEN));

  it("parses the header fields and var table", () => {
    expect(decoder.header).toMatchObject({
      version: 2,
      tickRate: 60,
      sessionInfoUpdate: 7,
      numVars: SPECS.length,
      varHeaderOffset: VAR_HEADER_OFFSET,
      numBuf: 3,
      bufLen: BUF_LEN,
    });
    expect(decoder.vars.size).toBe(SPECS.length);
    expect(decoder.vars.get("CarIdxPosition")).toEqual({
      name: "CarIdxPosition",
      type: VarType.Int,
      offset: 40,
      count: 4,
    });
    expect(decoder.has("Nope")).toBe(false);
  });

  it("reads each scalar type", () => {
    const r = decoder.reader(buildBuffer());
    expect(r.number("SessionTime")).toBe(1234.5); // double
    expect(r.number("SessionNum")).toBe(-3); // signed int
    expect(r.number("SessionFlags")).toBe(0x80000004); // bitfield is unsigned
    expect(r.number("Throttle")).toBe(0.25); // float
    expect(r.bool("IsOnTrack")).toBe(true); // bool
    expect(r.text("Tag")).toBe("ABC"); // char[] up to NUL
  });

  it("reads arrays element by element and as a whole", () => {
    const r = decoder.reader(buildBuffer());
    expect(r.numbers("CarIdxLapDistPct")).toEqual([0.5, 0.75, -1, 1]);
    expect(r.numbers("CarIdxPosition")).toEqual([3, 0, -1, 7]);
    expect(r.number("CarIdxPosition", 3)).toBe(7);
    expect(r.bool("CarIdxOnPitRoad", 0)).toBe(true);
    expect(r.bool("CarIdxOnPitRoad", 1)).toBe(false);
    expect(r.numbers("SessionNum")).toEqual([-3]);
  });

  it("gives null for missing vars, bad indexes and reads past the buffer", () => {
    const r = decoder.reader(buildBuffer());
    expect(r.number("Nope")).toBeNull();
    expect(r.bool("Nope")).toBeNull();
    expect(r.numbers("Nope")).toEqual([]);
    expect(r.text("Throttle")).toBeNull();
    expect(r.number("CarIdxPosition", 4)).toBeNull();
    expect(r.number("CarIdxPosition", -1)).toBeNull();
    const short = decoder.reader(buildBuffer().subarray(0, 20));
    expect(short.number("SessionTime")).toBe(1234.5);
    expect(short.number("CarIdxPosition", 0)).toBeNull();
  });

  it("reads from a buffer that is a view into a larger one", () => {
    const whole = Buffer.concat([Buffer.alloc(4, 0xff), buildBuffer()]);
    const r = decoder.reader(whole.subarray(4));
    expect(r.number("SessionNum")).toBe(-3);
    expect(r.numbers("CarIdxPosition")).toEqual([3, 0, -1, 7]);
  });

  it("treats NaN as unknown", () => {
    const b = buildBuffer();
    b.writeFloatLE(Number.NaN, 16);
    expect(decoder.reader(b).number("Throttle")).toBeNull();
  });

  it("skips var headers with an unknown type and rejects a cut-off table", () => {
    const odd = buildHeader(
      [{ name: "Odd", type: 9 as VarTypeId, offset: 0, count: 1 }, ...SPECS],
      BUF_LEN,
    );
    expect(IracingDecoder.fromHeaderBytes(odd).has("Odd")).toBe(false);
    expect(IracingDecoder.fromHeaderBytes(odd).has("SessionNum")).toBe(true);
    expect(() =>
      IracingDecoder.fromHeaderBytes(buildHeader(SPECS, BUF_LEN).subarray(0, 200)),
    ).toThrow(/cut off/);
    expect(() => IracingDecoder.fromHeaderBytes(Buffer.alloc(10))).toThrow(/too short/);
  });

  it("extracts the live session YAML from the header area", () => {
    const header = buildHeader(SPECS, BUF_LEN);
    const yaml = "---\nWeekendInfo:\n TrackName: x\n";
    const area = Buffer.alloc(64);
    area.write(yaml, 0, "latin1");
    const withYaml = Buffer.concat([header.subarray(0, 112), area, header.subarray(112)]);
    withYaml.writeInt32LE(112, 20);
    withYaml.writeInt32LE(64, 16);
    withYaml.writeInt32LE(112 + 64, 28);
    const d = IracingDecoder.fromHeaderBytes(withYaml);
    expect(d.sessionInfoText(withYaml)).toBe(yaml);
    expect(decoder.sessionInfoText(header)).toBeNull();
  });
});
