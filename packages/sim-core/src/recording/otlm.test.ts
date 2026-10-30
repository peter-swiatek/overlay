import { describe, expect, it } from "vitest";
import { OTLM_FORMAT, OTLM_VERSION, OtlmWriter, readOtlm, type OtlmHeader } from "./otlm";

class MemorySink {
  parts: Uint8Array[] = [];
  append(bytes: Uint8Array): void {
    this.parts.push(Buffer.from(bytes));
  }
  bytes(): Buffer {
    return Buffer.concat(this.parts);
  }
}

const header: OtlmHeader = {
  format: OTLM_FORMAT,
  version: OTLM_VERSION,
  sessionId: "s-1",
  sim: "iracing",
  startedAt: 1_793_000_000_000,
  groups: [
    {
      id: "a",
      rateHz: 10,
      chunkSamples: 5,
      channels: [
        { name: "t", unit: "s", type: "i32", scale: 1000, delta: true },
        { name: "speed", unit: "m/s", type: "f32" },
        { name: "gear", unit: "gear", type: "i8" },
        { name: "exact", unit: "", type: "f64" },
        { name: "cars", unit: "", type: "i16", scale: 100, delta: true, count: 3 },
      ],
    },
    {
      id: "b",
      rateHz: 1,
      chunkSamples: 4,
      channels: [{ name: "x", unit: "", type: "i16" }],
    },
  ],
};

function rowA(i: number): number[] {
  return [
    i * 0.1,
    50 + i,
    i % 7 === 3 ? NaN : (i % 6) - 1,
    Math.PI * i,
    i / 10,
    i % 4 === 0 ? NaN : (i * 37) % 100,
    1 - i / 100,
  ];
}

function write(samplesA: number, samplesB: number, close: boolean) {
  const sink = new MemorySink();
  const writer = new OtlmWriter(sink, header);
  for (let i = 0; i < samplesA; i++) writer.addSample("a", rowA(i));
  for (let i = 0; i < samplesB; i++) writer.addSample("b", [i]);
  writer.flush();
  if (close) writer.close();
  return { sink, writer };
}

describe("OTLM round trip", () => {
  it("restores every value within the stored precision, NaN included", () => {
    const { sink } = write(23, 6, true);
    const file = readOtlm(sink.bytes());
    expect(file.complete).toBe(true);
    expect(file.strayBytes).toBe(0);
    expect(file.header).toEqual(header);
    const a = file.groups["a"]!;
    expect(a.samples).toBe(23);
    for (let i = 0; i < 23; i++) {
      const row = rowA(i);
      expect(a.channels["t"]![i]).toBeCloseTo(row[0]!, 9);
      expect(a.channels["speed"]![i]).toBeCloseTo(row[1]!, 4);
      const gear = a.channels["gear"]![i]!;
      if (Number.isNaN(row[2]!)) expect(gear).toBeNaN();
      else expect(gear).toBe(row[2]);
      expect(a.channels["exact"]![i]).toBe(row[3]);
      for (let e = 0; e < 3; e++) {
        const want = e === 0 ? row[4]! : e === 1 ? row[5]! : row[6]!;
        const got = a.channels["cars"]![i * 3 + e]!;
        if (Number.isNaN(want)) expect(got).toBeNaN();
        else expect(got).toBeCloseTo(want, 2);
      }
    }
    const b = file.groups["b"]!;
    expect(Array.from(b.channels["x"]!)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps delta coding exact when differences overflow the stored width", () => {
    const sink = new MemorySink();
    const h: OtlmHeader = {
      ...header,
      groups: [
        {
          id: "w",
          rateHz: 1,
          chunkSamples: 10,
          channels: [{ name: "v", unit: "", type: "i8", delta: true }],
        },
      ],
    };
    const writer = new OtlmWriter(sink, h);
    const values = [0, 120, -120, 100, -100, 5, NaN, 7, 127, -127];
    for (const v of values) writer.addSample("w", [v]);
    writer.close();
    const out = Array.from(readOtlm(sink.bytes()).groups["w"]!.channels["v"]!);
    expect(out.map((v) => (Number.isNaN(v) ? "nan" : v))).toEqual(
      values.map((v) => (Number.isNaN(v) ? "nan" : v)),
    );
  });

  it("clamps values outside the integer range instead of wrapping", () => {
    const sink = new MemorySink();
    const h: OtlmHeader = {
      ...header,
      groups: [
        { id: "c", rateHz: 1, chunkSamples: 4, channels: [{ name: "v", unit: "", type: "i8" }] },
      ],
    };
    const writer = new OtlmWriter(sink, h);
    for (const v of [1000, -1000, Infinity]) writer.addSample("c", [v]);
    writer.close();
    expect(Array.from(readOtlm(sink.bytes()).groups["c"]!.channels["v"]!).slice(0, 2)).toEqual([
      127, -127,
    ]);
  });

  it("writes chunks of the configured size and only on flush", () => {
    const sink = new MemorySink();
    const writer = new OtlmWriter(sink, header);
    const headerOnly = sink.parts.length;
    for (let i = 0; i < 12; i++) writer.addSample("a", rowA(i));
    expect(sink.parts.length).toBe(headerOnly);
    expect(writer.pendingSamples).toBe(12);
    writer.flush();
    expect(writer.chunkCount).toBe(2); // two full chunks of 5; two samples wait
    expect(writer.pendingSamples).toBe(2);
    writer.flush(true);
    expect(writer.chunkCount).toBe(3);
    expect(writer.pendingSamples).toBe(0);
  });

  it("rejects rows of the wrong width and unknown groups", () => {
    const writer = new OtlmWriter(new MemorySink(), header);
    expect(() => writer.addSample("a", [1, 2])).toThrow(/takes 7 values/);
    expect(() => writer.addSample("zz", [1])).toThrow(/Unknown group/);
  });

  it("rejects scale and delta on float channels", () => {
    const bad: OtlmHeader = {
      ...header,
      groups: [
        {
          id: "f",
          rateHz: 1,
          chunkSamples: 1,
          channels: [{ name: "v", unit: "", type: "f32", delta: true }],
        },
      ],
    };
    expect(() => new OtlmWriter(new MemorySink(), bad)).toThrow(/integer types/);
  });

  it("ignores samples after close", () => {
    const sink = new MemorySink();
    const writer = new OtlmWriter(sink, header);
    writer.addSample("a", rowA(0));
    writer.close();
    const size = sink.bytes().length;
    writer.addSample("a", rowA(1));
    writer.flush(true);
    writer.close();
    expect(sink.bytes().length).toBe(size);
  });
});

describe("OTLM crash tolerance", () => {
  it("reads a file with no footer: every flushed chunk, marked incomplete", () => {
    const { sink } = write(17, 5, false);
    const file = readOtlm(sink.bytes());
    expect(file.complete).toBe(false);
    expect(file.strayBytes).toBe(0);
    expect(file.groups["a"]!.samples).toBe(15);
    expect(file.groups["b"]!.samples).toBe(4);
  });

  it("keeps the good chunks when the last chunk is cut in half", () => {
    const { sink } = write(15, 0, false);
    const whole = sink.bytes();
    const intact = readOtlm(whole);
    expect(intact.groups["a"]!.samples).toBe(15);
    const cut = whole.subarray(0, whole.length - 20);
    const file = readOtlm(cut);
    expect(file.complete).toBe(false);
    expect(file.groups["a"]!.samples).toBe(10);
    expect(file.strayBytes).toBeGreaterThan(0);
    expect(Array.from(file.groups["a"]!.channels["speed"]!.subarray(0, 3))).toEqual([50, 51, 52]);
  });

  it("reads a file cut anywhere after the header", () => {
    const { sink } = write(21, 8, true);
    const whole = sink.bytes();
    const headerLength = 12 + whole.readUInt32LE(8);
    let previous = 0;
    for (let length = headerLength; length <= whole.length; length += 23) {
      const file = readOtlm(whole.subarray(0, length));
      const samples = file.groups["a"]!.samples + file.groups["b"]!.samples;
      expect(samples).toBeGreaterThanOrEqual(previous);
      previous = samples;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it("stops at a chunk whose bytes were damaged", () => {
    const { sink } = write(15, 0, true);
    const bytes = Buffer.from(sink.bytes());
    const headerLength = 12 + bytes.readUInt32LE(8);
    // Flip a byte inside the second chunk's payload.
    const firstGzip = bytes.readUInt32LE(headerLength + 16);
    const second = headerLength + 24 + firstGzip;
    bytes[second + 30] = (bytes[second + 30]! ^ 0xff) & 0xff;
    const file = readOtlm(bytes);
    expect(file.complete).toBe(false);
    expect(file.groups["a"]!.samples).toBe(5);
  });

  it("refuses a file without a readable header", () => {
    expect(() => readOtlm(Buffer.from("nope"))).toThrow(/Not an OTLM/);
    const { sink } = write(1, 0, false);
    expect(() => readOtlm(sink.bytes().subarray(0, 20))).toThrow(/cut short/);
  });
});
