import { beforeAll, describe, expect, it } from "vitest";
import { lmu, type FixtureRecord } from "@overlay/sim-core";
import { FakeClock, FakeMapping, FakeSharedMemory } from "../capture/fakes";
import { LMU_DATA_NAME, LMU_LOCK_DATA_NAME, LMU_MAX_COPY_ATTEMPTS } from "../capture/lmu-names";
import { STALE_CLOSE_MS } from "../capture/sim-capture";
import { LMU_REST_ALLOWLIST, LmuRestClient, type FetchLike } from "../capture/rest-client";
import { LMU_REPAIR_POLL_MS, LmuLiveSource, type LmuRestGetter } from "./lmu-live";
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

  describe("repair screen polling", () => {
    const body = { wearables: { body: { aero: 0.05 }, suspension: [0.02, 0, 0.1, 0] } };

    /** A REST client whose answers the test releases by hand. */
    function manualRest() {
      const calls: string[] = [];
      const pending: ((r: { path: string; status: number; body: unknown }) => void)[] = [];
      const rest: LmuRestGetter = {
        get: (path) => {
          calls.push(path);
          return new Promise((resolve) => pending.push(resolve));
        },
      };
      return { rest, calls, pending };
    }

    function setupWith(rest: LmuRestGetter) {
      const shm = new FakeSharedMemory();
      const mapping = new FakeMapping(Buffer.from(buffers[0] as Buffer));
      shm.mappings.set(LMU_DATA_NAME, mapping);
      const clock = new FakeClock();
      return { mapping, clock, source: new LmuLiveSource(shm, clock, rest) };
    }

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("asks for the repair screen while frames decode, one at a time, every 2 s", async () => {
      const { rest, calls, pending } = manualRest();
      const { mapping, clock, source } = setupWith(rest);
      await source.read();
      expect(calls).toEqual([]); // nothing decoded yet
      publish(mapping, 1);
      const first = await source.read();
      expect(calls).toEqual([lmu.LMU_REPAIR_PATH]);
      expect(first?.state.player.damage?.aero).toBeNull();
      // Still in flight: no second request, however long it takes.
      clock.advance(LMU_REPAIR_POLL_MS * 3);
      publish(mapping, 2);
      await source.read();
      expect(calls).toHaveLength(1);
      pending[0]?.({ path: lmu.LMU_REPAIR_PATH, status: 200, body });
      await flush();
      publish(mapping, 3);
      const after = await source.read();
      expect(after?.state.player.damage?.aero).toBe(0.05);
      expect(after?.state.player.damage?.suspension).toEqual({ fl: 0.02, fr: 0, rl: 0.1, rr: 0 });
      expect(calls).toHaveLength(2); // due again, and the first one is done
      clock.advance(LMU_REPAIR_POLL_MS - 1);
      pending[1]?.({ path: lmu.LMU_REPAIR_PATH, status: 200, body });
      await flush();
      publish(mapping, 4);
      await source.read();
      expect(calls).toHaveLength(2); // not due yet
    });

    it("drops the damage values when a request fails or throws", async () => {
      let answer: () => Promise<{ path: string; status: number; body: unknown }> = async () => ({
        path: lmu.LMU_REPAIR_PATH,
        status: 200,
        body,
      });
      const { mapping, clock, source } = setupWith({ get: () => answer() });
      await source.read();
      publish(mapping, 1);
      await source.read();
      await flush();
      publish(mapping, 2);
      expect((await source.read())?.state.player.damage?.aero).toBe(0.05);
      answer = () => Promise.reject(new Error("game gone"));
      clock.advance(LMU_REPAIR_POLL_MS);
      publish(mapping, 3);
      await source.read();
      await flush();
      publish(mapping, 4);
      const frame = await source.read();
      expect(frame?.state.player.damage?.aero).toBeNull();
      expect(frame?.state.player.damage?.suspension).toBeNull();
    });

    it("never asks while the game is not running", async () => {
      const { rest, calls } = manualRest();
      const source = new LmuLiveSource(new FakeSharedMemory(), new FakeClock(), rest);
      source.probe();
      await source.read();
      expect(calls).toEqual([]);
    });

    it("uses an allowlisted path, which the REST client sends as a GET", async () => {
      expect(LMU_REST_ALLOWLIST).toContain(lmu.LMU_REPAIR_PATH);
      const seen: { url: string; method: string }[] = [];
      const fetchFn: FetchLike = async (url, init) => {
        seen.push({ url, method: init.method });
        return { status: 200, text: async () => JSON.stringify(body) };
      };
      const result = await new LmuRestClient(new FakeClock(), fetchFn).get(lmu.LMU_REPAIR_PATH);
      expect(result.status).toBe(200);
      expect(seen).toEqual([{ url: expect.stringContaining(lmu.LMU_REPAIR_PATH), method: "GET" }]);
    });
  });
});
