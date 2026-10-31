import { beforeAll, describe, expect, it } from "vitest";
import { lmu, type FixtureRecord } from "@overlay/sim-core";
import { FakeClock, FakeMapping, FakeSharedMemory } from "../capture/fakes";
import { LMU_DATA_NAME, LMU_LOCK_DATA_NAME, LMU_MAX_COPY_ATTEMPTS } from "../capture/lmu-names";
import { STALE_CLOSE_MS } from "../capture/sim-capture";
import { LmuLiveSource } from "./lmu-live";
import { LMU_ON_PACE, RecordKind, readRecords } from "./testing";

let buffers: Buffer[];
beforeAll(async () => {
  const records: FixtureRecord[] = await readRecords(LMU_ON_PACE);
  buffers = records.filter((r) => r.kind === RecordKind.LmuBuffer).map((r) => r.payload);
});

function setup() {
  const shm = new FakeSharedMemory();
  const mapping = new FakeMapping(Buffer.from(buffers[0] as Buffer));
  shm.mappings.set(LMU_DATA_NAME, mapping);
  // A lock mapping exists, and the source must leave it alone.
  shm.mappings.set(LMU_LOCK_DATA_NAME, new FakeMapping(Buffer.alloc(8)));
  const clock = new FakeClock();
  return { shm, mapping, clock, source: new LmuLiveSource(shm, clock) };
}

function publish(mapping: FakeMapping, index: number): void {
  (buffers[index] as Buffer).copy(mapping.data);
}

describe("LmuLiveSource", () => {
  it("decodes like LmuDecoder and returns nothing for an unchanged buffer", async () => {
    const { mapping, source } = setup();
    expect(await source.read()).toBeNull(); // first sight, nothing to compare with
    publish(mapping, 1);
    const frame = await source.read();
    const expected = new lmu.LmuDecoder().decode(
      (buffers[1] as Buffer).subarray(0, lmu.LMU_USED_BYTES),
    );
    expect(frame?.error).toBeNull();
    expect(frame?.state).toEqual(expected.state);
    expect(frame?.state.source).toBe("lmu");
    expect(await source.read()).toBeNull();
  });

  it("reads only the used bytes, twice per frame, and never touches the lock or events", async () => {
    const { shm, mapping, source } = setup();
    await source.read();
    mapping.copies = 0;
    publish(mapping, 1);
    await source.read();
    expect(mapping.copies).toBe(2);
    expect(mapping.size).toBeGreaterThanOrEqual(lmu.LMU_USED_BYTES);
    const lock = shm.mappings.get(LMU_LOCK_DATA_NAME);
    expect(lock?.opens).toBe(0);
    expect(shm.events.size).toBe(0);
  });

  it("retries torn copies up to 5 times and then drops the frame", async () => {
    const { mapping, source } = setup();
    await source.read();
    publish(mapping, 1);
    // The writer changes a byte after every copy, so no two copies ever match.
    let n = 0;
    mapping.onCopy = () => {
      mapping.data[100] = ++n % 256;
    };
    mapping.copies = 0;
    expect(await source.read()).toBeNull();
    expect(mapping.copies).toBe(2 * LMU_MAX_COPY_ATTEMPTS);
    expect(source.inconsistentDropped).toBe(1);

    // One torn attempt, then a stable one: the frame is kept.
    let torn = 1;
    mapping.onCopy = () => {
      if (torn-- > 0) mapping.data[100] = (mapping.data[100] ?? 0) ^ 0xff;
    };
    mapping.copies = 0;
    const frame = await source.read();
    expect(frame).not.toBeNull();
    expect(mapping.copies).toBe(4);
  });

  it("is live while the buffer changes and not after 5 s of silence", () => {
    const { mapping, clock, source } = setup();
    expect(source.probe()).toBe(false); // first copy only
    clock.advance(1000);
    publish(mapping, 1);
    expect(source.probe()).toBe(true);
    clock.advance(4900);
    expect(source.probe()).toBe(true);
    clock.advance(200);
    expect(source.probe()).toBe(false);
    clock.advance(STALE_CLOSE_MS);
    expect(source.probe()).toBe(false);
    expect(mapping.closes).toBe(1);
  });

  it("is not live when the game is not running", async () => {
    const source = new LmuLiveSource(new FakeSharedMemory(), new FakeClock());
    expect(source.probe()).toBe(false);
    expect(await source.read()).toBeNull();
  });

  it("reports undecodable data as an error frame", async () => {
    const { mapping, source } = setup();
    await source.read();
    mapping.data.fill(0xff, 0, 4096);
    const frame = await source.read();
    expect(frame?.error).toEqual(expect.any(String));
    expect(frame?.state.connected).toBe(false);
  });
});
