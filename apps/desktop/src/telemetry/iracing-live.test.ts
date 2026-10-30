import { beforeAll, describe, expect, it } from "vitest";
import { iracing, type FixtureRecord } from "@overlay/sim-core";
import { FakeClock, FakeEvent, FakeSharedMemory } from "../capture/fakes";
import { IRSDK_EVENT_NAME, IRSDK_MAP_NAME } from "../capture/irsdk";
import { STALE_CLOSE_MS } from "../capture/sim-capture";
import { IRACING_EVENT_WAIT_MS, IracingLiveSource } from "./iracing-live";
import {
  runSessionJob,
  WorkerSessionParser,
  type SessionJob,
  type SessionJobResult,
  type WorkerLike,
} from "./session-parser";
import { FakeIrsdk, IRACING_RACE_START, RecordKind, readRecords } from "./testing";

/** A worker that answers on the next macrotask, like a real thread would. */
class FakeWorker implements WorkerLike {
  jobs: SessionJob[] = [];
  terminated = false;
  private listener: ((r: SessionJobResult) => void) | undefined;
  postMessage(job: SessionJob): void {
    this.jobs.push(job);
    setTimeout(() => this.listener?.(runSessionJob(job)), 0);
  }
  on(event: string, listener: (arg: never) => void): unknown {
    if (event === "message") this.listener = listener as (r: SessionJobResult) => void;
    return this;
  }
  terminate(): void {
    this.terminated = true;
  }
}

let records: FixtureRecord[];
beforeAll(async () => {
  records = await readRecords(IRACING_RACE_START);
});

const of = (kind: number): FixtureRecord[] => records.filter((r) => r.kind === kind);

function setup() {
  const headerRecord = of(RecordKind.IracingHeader)[0] as FixtureRecord;
  const irsdk = new FakeIrsdk(headerRecord.payload);
  irsdk.setYaml((of(RecordKind.IracingSessionYaml)[0] as FixtureRecord).payload);
  const shm = new FakeSharedMemory();
  shm.mappings.set(IRSDK_MAP_NAME, irsdk.mapping);
  const event = new FakeEvent();
  shm.events.set(IRSDK_EVENT_NAME, event);
  const clock = new FakeClock();
  const worker = new FakeWorker();
  const source = new IracingLiveSource(shm, clock, new WorkerSessionParser(() => worker));
  const vars = of(RecordKind.IracingVarBuffer).map((r) => r.payload.subarray(4));
  return { irsdk, shm, event, clock, worker, source, vars, headerRecord };
}

describe("IracingLiveSource", () => {
  it("waits at most 20 ms on the event, decodes like the adapter, and skips repeated ticks", async () => {
    const { irsdk, event, source, vars, headerRecord } = setup();
    expect(source.probe()).toBe(true);
    irsdk.setVars(vars[10] as Uint8Array);

    const first = await source.read();
    expect(event.waits).toEqual([IRACING_EVENT_WAIT_MS]);
    expect(first?.state.connected).toBe(true);
    expect(first?.state.source).toBe("iracing");
    // The session YAML is still being parsed in the worker, so there is no session type yet.
    expect(first?.state.session.type).toBeNull();

    expect(await source.read()).toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    irsdk.setVars(vars[10] as Uint8Array);
    const second = await source.read();
    const info = iracing.parseSessionYaml(
      iracing.decodeSessionYaml((of(RecordKind.IracingSessionYaml)[0] as FixtureRecord).payload),
    );
    const expected = iracing.IracingAdapter.fromHeaderBytes(headerRecord.payload).toSimState(
      vars[10] as Uint8Array,
      info,
    );
    expect(second?.state).toEqual(expected);
  });

  it("parses the YAML only when SessionInfoUpdate changes, never per frame", async () => {
    const { irsdk, worker, source, vars } = setup();
    source.probe();
    for (let i = 0; i < 20; i++) {
      irsdk.setVars(vars[i] as Uint8Array);
      await source.read();
    }
    expect(worker.jobs).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 5));
    irsdk.setYaml((of(RecordKind.IracingSessionYaml)[0] as FixtureRecord).payload);
    irsdk.setVars(vars[30] as Uint8Array);
    await source.read();
    expect(worker.jobs).toHaveLength(2);

    // Changes while a parse runs collapse into one follow-up parse (3 jobs in all, not 4).
    irsdk.setYaml((of(RecordKind.IracingSessionYaml)[0] as FixtureRecord).payload);
    irsdk.setVars(vars[31] as Uint8Array);
    await source.read();
    irsdk.setYaml((of(RecordKind.IracingSessionYaml)[0] as FixtureRecord).payload);
    irsdk.setVars(vars[32] as Uint8Array);
    await source.read();
    await new Promise((r) => setTimeout(r, 10));
    expect(worker.jobs).toHaveLength(3);
  });

  it("drops a var buffer the sim rewrote while it was copied", async () => {
    const { irsdk, shm, source, vars } = setup();
    source.probe();
    irsdk.setVars(vars[1] as Uint8Array, 5);
    // After the var buffer copy (the one of bufLen bytes), the sim moves on to the next tick.
    const mapping = shm.mappings.get(IRSDK_MAP_NAME);
    let armed = true;
    if (mapping) {
      mapping.onCopy = (_offset, length) => {
        if (armed && length > 1000 && length < 100_000) {
          armed = false;
          irsdk.bumpTickInPlace(6);
        }
      };
    }
    await source.read();
    expect(armed).toBe(false);
    expect(source.tornDiscarded).toBe(1);
  });

  it("is not live without the connected bit or when ticks stop, and closes stale handles", async () => {
    const { irsdk, shm, clock, source, vars } = setup();
    irsdk.setVars(vars[0] as Uint8Array);
    expect(source.probe()).toBe(true);
    irsdk.setConnected(false);
    expect(source.probe()).toBe(false);
    irsdk.setConnected(true);
    expect(source.probe()).toBe(true);

    clock.advance(STALE_CLOSE_MS + 1000);
    expect(source.probe()).toBe(false);
    const mapping = shm.mappings.get(IRSDK_MAP_NAME);
    expect(mapping?.closes).toBe(1);
    // It reopens when the sim comes back.
    irsdk.setVars(vars[5] as Uint8Array);
    expect(source.probe()).toBe(true);
    expect(mapping?.opens).toBe(2);
  });

  it("is not live and reads nothing when the sim is not running", async () => {
    const source = new IracingLiveSource(
      new FakeSharedMemory(),
      new FakeClock(),
      new WorkerSessionParser(() => new FakeWorker()),
    );
    expect(source.probe()).toBe(false);
    expect(await source.read()).toBeNull();
  });
});
