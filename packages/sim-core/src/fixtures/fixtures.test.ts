import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  FixtureReader,
  FixtureWriter,
  RECORD_HEAD_BYTES,
  RecordKind,
  encodeRecord,
  fixtureFileName,
  parseJsonPayload,
  readAllRecords,
  type HeaderFields,
} from "./index";

class MemorySink extends Writable {
  readonly chunks: Buffer[] = [];
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.chunks.push(chunk);
    cb();
  }
  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function fakeClock() {
  let t = 0;
  return {
    monoMs: () => (t += 1),
    wallMs: () => 1_700_000_000_000 + t,
  };
}

const header: HeaderFields = {
  sim: "iracing",
  captureToolVersion: "1",
  appVersion: "0.0.0",
  os: "test",
  startedUtc: "2026-10-30T10:00:00.000Z",
  notes: "",
};

async function* once<T>(value: T): AsyncGenerator<T> {
  yield value;
}

describe("fixture container", () => {
  it("round-trips records of every kind", async () => {
    const sink = new MemorySink();
    const writer = new FixtureWriter(sink, header, { clock: fakeClock() });
    const blob = Buffer.from([1, 2, 3, 4]);
    await writer.write(RecordKind.IracingHeader, blob);
    await writer.write(RecordKind.IracingSessionYaml, "WeekendInfo:\n  TrackName: x\n");
    await writer.write(RecordKind.IracingVarBuffer, Buffer.alloc(10, 7));
    await writer.write(RecordKind.LmuBuffer, Buffer.alloc(50, 9));
    await writer.write(RecordKind.LmuSync, { consistent: true });
    await writer.write(RecordKind.RestResponse, {
      path: "/a",
      status: 200,
      latencyMs: 3,
      body: {},
    });
    await writer.write(RecordKind.Marker, { label: "pit stop" });
    await writer.close({ note: "bye" });

    const { reader, records } = await readAllRecords(once(sink.bytes()));
    expect(records.map((r) => r.kind)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(reader.header).toMatchObject({ format: "ovfx", version: 1, sim: "iracing" });
    expect(records[1]?.payload).toEqual(blob);
    expect(records[2]?.payload.toString()).toContain("TrackName");
    expect(records[3]?.payload.length).toBe(10);
    expect(parseJsonPayload(records[7]!)).toEqual({ label: "pit stop" });
    expect(records[2]!.wallMs).toBeGreaterThan(1_700_000_000_000);
    expect(records[2]!.monoMs).toBeGreaterThan(records[1]!.monoMs);
    expect(reader.summary).toMatchObject({ note: "bye" });
    expect(reader.truncated).toBe(false);
  });

  it("uses the documented record framing", () => {
    const rec = encodeRecord(5, 1.5, 2.5, Buffer.from("ab"));
    expect(rec.length).toBe(RECORD_HEAD_BYTES + 2);
    expect(rec.readUInt8(0)).toBe(5);
    expect(rec.readUInt32LE(1)).toBe(2);
    expect(rec.readDoubleLE(5)).toBe(1.5);
    expect(rec.readDoubleLE(13)).toBe(2.5);
  });

  it("skips unknown record kinds", async () => {
    const sink = new MemorySink();
    const writer = new FixtureWriter(sink, header, { clock: fakeClock() });
    await writer.write(200, Buffer.from("future"));
    await writer.write(RecordKind.Marker, { label: "m" });
    await writer.close();
    const { records } = await readAllRecords(once(sink.bytes()));
    expect(records.map((r) => r.kind)).toEqual([1, 8, 9]);
  });

  it("recovers complete records from a truncated file and reports truncation", async () => {
    const sink = new MemorySink();
    const writer = new FixtureWriter(sink, header, { clock: fakeClock() });
    await writer.write(RecordKind.IracingVarBuffer, Buffer.alloc(1000, 1));
    await writer.write(RecordKind.Marker, { label: "flushed" }); // sync flush
    const flushed = sink.bytes();
    await writer.write(RecordKind.IracingVarBuffer, Buffer.alloc(1000, 2));
    await writer.close();

    // Cut right after the marker's sync flush: no trailer, no summary.
    const { reader, records } = await readAllRecords(once(flushed));
    expect(records.map((r) => r.kind)).toEqual([1, 4, 8]);
    expect(reader.truncated).toBe(true);
    expect(reader.summary).toBeUndefined();

    // Cut mid-file: still yields a prefix of complete records.
    const full = sink.bytes();
    const cut = full.subarray(0, flushed.length + 5);
    const partial = await readAllRecords(once(cut));
    expect(partial.records.length).toBeGreaterThanOrEqual(3);
    expect(partial.reader.truncated).toBe(true);
  });

  it("flushes on the 1 s timer without a marker", async () => {
    const sink = new MemorySink();
    const writer = new FixtureWriter(sink, header, { clock: fakeClock(), flushIntervalMs: 20 });
    await writer.write(RecordKind.IracingVarBuffer, Buffer.alloc(100, 1));
    await new Promise((r) => setTimeout(r, 150));
    const { records } = await readAllRecords(once(sink.bytes()));
    expect(records.map((r) => r.kind)).toEqual([1, 4]);
    await writer.close();
  });

  it("rejects non-fixture data and newer versions", async () => {
    await expect(readAllRecords(once(Buffer.from("not gzip")))).rejects.toThrow();
    const sink = new MemorySink();
    const writer = new FixtureWriter(sink, { ...header, version: 2 } as HeaderFields, {
      clock: fakeClock(),
    });
    await writer.close();
    await expect(new FixtureReader(once(sink.bytes())).records().next()).rejects.toThrow(
      /Unsupported fixture version/,
    );
  });

  it("names files by sim and UTC timestamp", () => {
    const when = new Date("2026-10-30T10:15:00.123Z");
    expect(fixtureFileName("lmu", when)).toBe("lmu-20261030T101500Z.ovfx");
    expect(fixtureFileName("iracing", when, 1)).toBe("iracing-20261030T101500Z-2.ovfx");
  });

  it("compresses mostly-zero frames well (size test)", async () => {
    const frame = Buffer.alloc(327_680);
    const sink = new MemorySink();
    const writer = new FixtureWriter(sink, header, { clock: fakeClock() });
    for (let i = 0; i < 100; i++) {
      frame.writeDoubleLE(i * 0.2, 400);
      frame.writeFloatLE(i * 1.7, 5000);
      await writer.write(RecordKind.LmuBuffer, frame);
    }
    await writer.close();
    expect(sink.bytes().length).toBeLessThan(100 * 327_680 * 0.02);
    expect(writer.bytesUncompressed).toBeGreaterThan(100 * 327_680);
  });
});
