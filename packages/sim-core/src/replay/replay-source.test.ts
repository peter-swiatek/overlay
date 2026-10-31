import { createReadStream } from "node:fs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixtureWriter, RecordKind, readAllRecords, type FixtureRecord } from "../fixtures";
import { ReplaySource, fileSource, type ByteSourceFactory } from "./replay-source";

const slice = (name: string): string =>
  fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));

class MemorySink extends Writable {
  readonly chunks: Buffer[] = [];
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.chunks.push(chunk);
    cb();
  }
}

/** A tiny iRacing-shaped fixture: header, then var buffers at the given monotonic times (ms). */
async function memoryFixture(times: number[]): Promise<ByteSourceFactory> {
  const clock = { t: 0 };
  const sink = new MemorySink();
  const writer = new FixtureWriter(
    sink,
    {
      sim: "iracing",
      captureToolVersion: "1",
      appVersion: "0",
      os: "test",
      startedUtc: "2026-10-30T00:00:00.000Z",
      notes: "",
    },
    { clock: { monoMs: () => clock.t, wallMs: () => 1_700_000_000_000 + clock.t } },
  );
  for (const t of times) {
    clock.t = t;
    await writer.write(RecordKind.IracingVarBuffer, Buffer.from([t & 255]));
  }
  await writer.close();
  const bytes = Buffer.concat(sink.chunks);
  return () =>
    (async function* () {
      yield bytes;
    })();
}

/** Stream decoding takes real time that the fake clock also counts, so compare offsets only. */
function sinceFirst(frames: { atMs: number }[]): number[] {
  const first = frames[0]?.atMs ?? 0;
  return frames.map((f) => f.atMs - first);
}

/** Consumes a source under fake timers, returning virtual elapsed ms for each record. */
async function drainWithFakeTime(source: ReplaySource): Promise<{ kind: number; atMs: number }[]> {
  const out: { kind: number; atMs: number }[] = [];
  const start = Date.now();
  let done = false;
  const consumer = (async () => {
    for await (const record of source) out.push({ kind: record.kind, atMs: Date.now() - start });
    done = true;
  })();
  while (!done) {
    await vi.advanceTimersByTimeAsync(5);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await consumer;
  return out;
}

describe("ReplaySource pacing", () => {
  afterEach(() => vi.useRealTimers());

  it("plays in real time at speed 1", async () => {
    const open = await memoryFixture([5000, 5500, 7000]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const played = await drainWithFakeTime(new ReplaySource(open, { speed: 1 }));
    const frames = played.filter((r) => r.kind === RecordKind.IracingVarBuffer);
    expect(sinceFirst(frames)).toEqual([0, 500, 2000]);
  });

  it("plays twice as fast at speed 2", async () => {
    const open = await memoryFixture([5000, 5500, 7000]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const played = await drainWithFakeTime(new ReplaySource(open, { speed: 2 }));
    const frames = played.filter((r) => r.kind === RecordKind.IracingVarBuffer);
    expect(sinceFirst(frames)).toEqual([0, 250, 1000]);
  });

  it("stops waiting when the signal aborts", async () => {
    const open = await memoryFixture([0, 60_000]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const controller = new AbortController();
    const seen: number[] = [];
    let done = false;
    const consumer = (async () => {
      for await (const record of new ReplaySource(open, { signal: controller.signal })) {
        seen.push(record.kind);
      }
      done = true;
    })();
    while (!seen.includes(RecordKind.IracingVarBuffer)) {
      await vi.advanceTimersByTimeAsync(5);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    controller.abort();
    while (!done) await new Promise<void>((resolve) => setImmediate(resolve));
    await consumer;
    expect(seen.filter((k) => k === RecordKind.IracingVarBuffer)).toHaveLength(1);
  });
});

describe("ReplaySource over memory fixtures", () => {
  it("delivers everything immediately at speed 0, header first, summary last", async () => {
    const open = await memoryFixture([0, 1000, 2000]);
    const kinds: number[] = [];
    for await (const record of new ReplaySource(open, { speed: 0 })) kinds.push(record.kind);
    expect(kinds).toEqual([
      RecordKind.Header,
      RecordKind.IracingVarBuffer,
      RecordKind.IracingVarBuffer,
      RecordKind.IracingVarBuffer,
      RecordKind.Summary,
    ]);
  });

  it("seeks with startAtS", async () => {
    const open = await memoryFixture([1000, 2000, 3000, 4000]);
    const first: FixtureRecord[] = [];
    for await (const record of new ReplaySource(open, { speed: 0, startAtS: 2 }))
      first.push(record);
    const frames = first.filter((r) => r.kind === RecordKind.IracingVarBuffer);
    expect(frames).toHaveLength(2);
    expect(frames[0]?.monoMs).toBe(3000);
  });

  it("loops until stopped", async () => {
    const open = await memoryFixture([0, 10]);
    let headers = 0;
    for await (const record of new ReplaySource(open, { speed: 0, loop: true })) {
      if (record.kind === RecordKind.Header && ++headers === 3) break;
    }
    expect(headers).toBe(3);
  });

  it("does not loop forever over a file with no frames", async () => {
    const open = await memoryFixture([]);
    const kinds: number[] = [];
    for await (const record of new ReplaySource(open, { speed: 0, loop: true })) {
      kinds.push(record.kind);
      if (kinds.length > 10) break;
    }
    expect(kinds).toEqual([RecordKind.Header, RecordKind.Summary]);
  });

  it("rejects a negative speed", () => {
    expect(() => new ReplaySource(() => createReadStream("x"), { speed: -1 })).toThrow(RangeError);
  });
});

describe("ReplaySource over committed slices", () => {
  it("replays an iRacing slice exactly as stored", async () => {
    const file = slice("iracing-ferrari-quali-to-race-10s.ovfx");
    const expected = await readAllRecords(createReadStream(file));
    const source = new ReplaySource(fileSource(file), { speed: 0 });
    const played: FixtureRecord[] = [];
    for await (const record of source) played.push(record);
    expect(played).toHaveLength(expected.records.length);
    expect(played[0]?.kind).toBe(RecordKind.Header);
    expect(source.header?.sim).toBe("iracing");
    expect(source.header?.["sliceOf"]).toBe("iracing-20261030T074730Z.ovfx");
  });

  it("seeks inside an LMU slice and still delivers REST state first", async () => {
    const file = slice("lmu-hypercar-onpace-10s-5hz.ovfx");
    const played: FixtureRecord[] = [];
    for await (const record of new ReplaySource(fileSource(file), { speed: 0, startAtS: 5 })) {
      played.push(record);
    }
    const kinds = played.map((r) => r.kind);
    expect(kinds[0]).toBe(RecordKind.Header);
    expect(kinds[1] === RecordKind.RestResponse || kinds[1] === RecordKind.Marker).toBe(true);
    const syncs = played.filter((r) => r.kind === RecordKind.LmuSync).length;
    const buffers = played.filter((r) => r.kind === RecordKind.LmuBuffer).length;
    expect(syncs).toBe(buffers);
    expect(syncs).toBeGreaterThan(20);
    expect(syncs).toBeLessThan(30);
  });
});
