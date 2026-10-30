import { RecordKind, type HeaderFields, type SimId } from "@overlay/sim-core";
import { describe, expect, it } from "vitest";
import { CaptureController, ROTATE_AFTER_MS, type FixtureFileFactory } from "./controller";
import { FakeClock, FakeEvent, FakeMapping, FakeSharedMemory } from "./fakes";
import {
  IRSDK_EVENT_NAME,
  IRSDK_MAP_NAME,
  IRSDK_VAR_HEADER_BYTES,
  IracingCapture,
  parseIrsdkHeader,
} from "./iracing";
import { LMU_BURST_FRAMES, LMU_DATA_NAME, LMU_LOCK_DATA_NAME, LmuCapture } from "./lmu";
import {
  LMU_REST_ALLOWLIST,
  LmuRestClient,
  RestRequestRejected,
  type FetchLike,
} from "./rest-client";
import type { RecordSink, SimCapture } from "./sim-capture";
import { STALE_CLOSE_MS } from "./sim-capture";

class CollectingSink implements RecordSink {
  records: { kind: number; payload: Uint8Array | string | object }[] = [];
  async write(kind: number, payload: Uint8Array | string | object): Promise<void> {
    // Frame buffers are reused by the capture, so keep only a copy.
    this.records.push({
      kind,
      payload: payload instanceof Uint8Array ? Buffer.from(payload) : payload,
    });
  }
  count(kind: number): number {
    return this.records.filter((r) => r.kind === kind).length;
  }
}

// ---- iRacing ----------------------------------------------------------------------------------

const IR_SIZE = 8192;
const SESSION_OFFSET = 1000;
const SESSION_LEN = 64;
const BUF_LEN = 100;
const BUF_OFFSETS = [2000, 2200, 2400];

interface IrState {
  status?: number;
  sessionInfoUpdate?: number;
  numVars?: number;
  ticks?: number[];
}

function writeIrHeader(data: Buffer, state: IrState): void {
  const numVars = state.numVars ?? 2;
  const ticks = state.ticks ?? [10, 11, 12];
  data.writeInt32LE(2, 0);
  data.writeInt32LE(state.status ?? 1, 4);
  data.writeInt32LE(60, 8);
  data.writeInt32LE(state.sessionInfoUpdate ?? 1, 12);
  data.writeInt32LE(SESSION_LEN, 16);
  data.writeInt32LE(SESSION_OFFSET, 20);
  data.writeInt32LE(numVars, 24);
  data.writeInt32LE(112, 28);
  data.writeInt32LE(3, 32);
  data.writeInt32LE(BUF_LEN, 36);
  ticks.forEach((tick, i) => {
    data.writeInt32LE(tick, 48 + i * 16);
    data.writeInt32LE(BUF_OFFSETS[i] ?? 0, 52 + i * 16);
  });
}

function irEnv(state: IrState = {}) {
  const clock = new FakeClock();
  const shm = new FakeSharedMemory();
  const data = Buffer.alloc(IR_SIZE);
  writeIrHeader(data, state);
  data.write("YAML: one\n", SESSION_OFFSET, "latin1");
  BUF_OFFSETS.forEach((offset, i) => data.fill(0xa0 + i, offset, offset + BUF_LEN));
  const mapping = new FakeMapping(data);
  shm.mappings.set(IRSDK_MAP_NAME, mapping);
  const event = new FakeEvent();
  shm.events.set(IRSDK_EVENT_NAME, event);
  const cap = new IracingCapture(shm, clock);
  const sink = new CollectingSink();
  const set = (patch: IrState) => {
    const current = parseIrsdkHeader(data);
    writeIrHeader(data, {
      status: current.status,
      sessionInfoUpdate: current.sessionInfoUpdate,
      numVars: current.numVars,
      ticks: current.varBuf.slice(0, 3).map((b) => b.tickCount),
      ...patch,
    });
  };
  return { clock, shm, data, mapping, event, cap, sink, set };
}

describe("iRacing capture", () => {
  it("is live only while the connected bit is set, even though the mapping opens", async () => {
    const env = irEnv({ status: 0 });
    await env.cap.probe();
    expect(env.cap.isOpen).toBe(true);
    expect(env.cap.live).toBe(false);
    env.set({ status: 1 });
    await env.cap.probe();
    expect(env.cap.live).toBe(true);
  });

  it("closes its handles after 10 s without a live signal", async () => {
    const env = irEnv({ status: 0 });
    await env.cap.probe();
    env.clock.advance(STALE_CLOSE_MS - 1);
    await env.cap.probe();
    expect(env.cap.isOpen).toBe(true);
    env.clock.advance(2);
    await env.cap.probe();
    expect(env.cap.isOpen).toBe(false);
    expect(env.mapping.closes).toBe(1);
    expect(env.event.closes).toBe(1);
  });

  it("copies the buffer with the highest tickCount and waits 200 ms on the event", async () => {
    const env = irEnv({ ticks: [10, 30, 20] });
    await env.cap.probe();
    await env.cap.beginFile(env.sink);
    await env.cap.step();
    const frame = env.sink.records.find((r) => r.kind === RecordKind.IracingVarBuffer);
    const payload = frame?.payload as Buffer;
    expect(payload.readInt32LE(0)).toBe(30);
    expect(payload[4]).toBe(0xa1);
    expect(payload.length).toBe(4 + BUF_LEN);
    expect(env.event.waits).toEqual([200]);
  });

  it("discards a torn tick and writes it on the next step", async () => {
    const env = irEnv({ ticks: [10, 11, 12] });
    await env.cap.probe();
    await env.cap.beginFile(env.sink);
    let tore = false;
    env.mapping.onCopy = (offset) => {
      // The sim reuses the oldest buffer while we copy the newest one.
      if (offset === BUF_OFFSETS[2] && !tore) {
        tore = true;
        env.set({ ticks: [10, 11, 13] });
      }
    };
    await env.cap.step();
    expect(env.sink.count(RecordKind.IracingVarBuffer)).toBe(0);
    expect(env.cap.tornDiscarded).toBe(1);
    await env.cap.step();
    expect(env.sink.count(RecordKind.IracingVarBuffer)).toBe(1);
    expect((env.sink.records.at(-1)?.payload as Buffer).readInt32LE(0)).toBe(13);
  });

  it("writes the header blob again only when numVars changes", async () => {
    const env = irEnv({ numVars: 2 });
    await env.cap.probe();
    await env.cap.beginFile(env.sink);
    await env.cap.step();
    env.set({ ticks: [10, 11, 14] });
    await env.cap.step();
    expect(env.sink.count(RecordKind.IracingHeader)).toBe(1);
    const first = env.sink.records.find((r) => r.kind === RecordKind.IracingHeader)
      ?.payload as Buffer;
    expect(first.length).toBe(112 + 2 * IRSDK_VAR_HEADER_BYTES);

    env.set({ numVars: 3, ticks: [10, 11, 15] });
    await env.cap.step();
    expect(env.sink.count(RecordKind.IracingHeader)).toBe(2);
    const second = env.sink.records.filter((r) => r.kind === RecordKind.IracingHeader)[1]
      ?.payload as Buffer;
    expect(second.length).toBe(112 + 3 * IRSDK_VAR_HEADER_BYTES);
  });

  it("writes the session YAML again when sessionInfoUpdate changes", async () => {
    const env = irEnv({ sessionInfoUpdate: 1 });
    await env.cap.probe();
    await env.cap.beginFile(env.sink);
    await env.cap.step();
    env.set({ ticks: [10, 11, 13] });
    await env.cap.step();
    expect(env.sink.count(RecordKind.IracingSessionYaml)).toBe(1);

    env.data.write("YAML: two\n", SESSION_OFFSET, "latin1");
    env.set({ sessionInfoUpdate: 2, ticks: [10, 11, 14] });
    await env.cap.step();
    const yamls = env.sink.records.filter((r) => r.kind === RecordKind.IracingSessionYaml);
    expect(yamls).toHaveLength(2);
    expect((yamls[1]?.payload as Buffer).toString("latin1")).toBe("YAML: two\n");
  });

  it("starts each file with a fresh header and YAML", async () => {
    const env = irEnv();
    await env.cap.probe();
    await env.cap.beginFile(env.sink);
    await env.cap.step();
    const second = new CollectingSink();
    await env.cap.beginFile(second);
    await env.cap.step();
    expect(second.count(RecordKind.IracingHeader)).toBe(1);
    expect(second.count(RecordKind.IracingSessionYaml)).toBe(1);
    expect(second.count(RecordKind.IracingVarBuffer)).toBe(1);
  });
});

// ---- LMU --------------------------------------------------------------------------------------

const LMU_SIZE = 327_680;

const okFetch: FetchLike = async () => ({
  status: 200,
  text: async () => JSON.stringify({ state: { appBuild: 14200 } }),
});

function lmuEnv(fetchFn: FetchLike = okFetch) {
  const clock = new FakeClock();
  const shm = new FakeSharedMemory();
  const data = Buffer.alloc(LMU_SIZE);
  const mapping = new FakeMapping(data);
  const lockData = Buffer.alloc(8);
  const lock = new FakeMapping(lockData);
  shm.mappings.set(LMU_DATA_NAME, mapping);
  shm.mappings.set(LMU_LOCK_DATA_NAME, lock);
  const calls: string[] = [];
  const rest = new LmuRestClient(clock, async (url, init) => {
    calls.push(`${init.method} ${url}`);
    return fetchFn(url, init);
  });
  const cap = new LmuCapture(shm, rest, clock);
  const sink = new CollectingSink();
  return { clock, shm, data, mapping, lockData, lock, calls, cap, sink };
}

describe("LMU capture", () => {
  it("records exactly 1,000 burst frames at the start of a file", async () => {
    const env = lmuEnv();
    await env.cap.probe(false); // REST answers, so the sim counts as live
    expect(env.cap.live).toBe(true);
    await env.cap.beginFile(env.sink);
    for (let i = 0; i < LMU_BURST_FRAMES; i++) await env.cap.step();
    await env.cap.settled();

    const syncs = env.sink.records
      .filter((r) => r.kind === RecordKind.LmuSync)
      .map((r) => r.payload as { burst: boolean });
    expect(syncs.filter((s) => s.burst)).toHaveLength(1000);
    expect(env.cap.burstFrames).toBe(1000);
    expect(env.sink.count(RecordKind.LmuBuffer)).toBe(1000);

    // After the burst, frames follow the configured rate and are not burst frames.
    env.clock.advance(1);
    await env.cap.step();
    expect(env.cap.burstFrames).toBe(1000);
    expect(env.cap.frames).toBe(1001);

    // "Mark moment" starts another burst of exactly 1,000.
    env.cap.onMarker();
    for (let i = 0; i < 1500; i++) await env.cap.step();
    expect(env.cap.burstFrames).toBe(2000);
  });

  it("copies twice, compares, and retries up to 5 times; flags inconsistent frames", async () => {
    const env = lmuEnv();
    await env.cap.probe(false);
    await env.cap.beginFile(env.sink);
    let torn = 3; // the first three copies are interrupted by a writer
    env.mapping.onCopy = () => {
      if (torn-- > 0) env.data.writeUInt32LE(torn + 1, 0);
    };
    await env.cap.step();
    const first = env.sink.records.find((r) => r.kind === RecordKind.LmuSync)?.payload as {
      consistent: boolean;
      attempts: number;
    };
    expect(first.consistent).toBe(true);
    expect(first.attempts).toBe(3);

    env.mapping.onCopy = () => {
      env.data.writeUInt32LE(Math.floor(Math.random() * 2 ** 31), 0);
    };
    await env.cap.step();
    const last = env.sink.records.filter((r) => r.kind === RecordKind.LmuSync).at(-1)?.payload as {
      consistent: boolean;
      attempts: number;
    };
    expect(last.consistent).toBe(false);
    expect(last.attempts).toBe(5);
    expect(env.cap.inconsistentFrames).toBe(1);
  });

  it("records the lock state before and after each copy without writing to it", async () => {
    const env = lmuEnv();
    env.lockData.writeUInt32LE(2, 0);
    env.lockData.writeUInt32LE(1, 4);
    await env.cap.probe(false);
    await env.cap.beginFile(env.sink);
    await env.cap.step();
    const sync = env.sink.records.find((r) => r.kind === RecordKind.LmuSync)?.payload as {
      lockBefore: { waiters: number; busy: number };
      lockAfter: { waiters: number; busy: number };
    };
    expect(sync.lockBefore).toMatchObject({ waiters: 2, busy: 1 });
    expect(sync.lockAfter).toMatchObject({ waiters: 2, busy: 1 });
    expect(env.lockData.readUInt32LE(4)).toBe(1); // untouched
  });

  it("is live only when REST answers or the buffer changes within 5 s", async () => {
    const env = lmuEnv(async () => {
      throw new Error("connection refused");
    });
    await env.cap.probe(false);
    expect(env.cap.isOpen).toBe(true);
    expect(env.cap.live).toBe(false);

    env.clock.advance(2000);
    env.data.writeUInt32LE(7, 100);
    await env.cap.probe(false);
    expect(env.cap.live).toBe(true);

    env.clock.advance(5001);
    await env.cap.probe(false);
    expect(env.cap.live).toBe(false);
    expect(env.cap.isOpen).toBe(true);

    env.clock.advance(5000);
    await env.cap.probe(false);
    expect(env.cap.isOpen).toBe(false);
    expect(env.mapping.closes).toBe(1);
    expect(env.lock.closes).toBe(1);
  });

  it("polls REST one request at a time with GET, the schema first, and stamps the build", async () => {
    const env = lmuEnv();
    await env.cap.probe(false);
    await env.cap.beginFile(env.sink);
    for (let i = 0; i < 4; i++) {
      await env.cap.step();
      await env.cap.settled();
      env.clock.advance(1000);
    }
    const urls = env.calls;
    expect(urls.every((c) => c.startsWith("GET http://127.0.0.1:6397/"))).toBe(true);
    expect(env.calls[1]).toBe("GET http://127.0.0.1:6397/swagger-schema.json");
    const rest = env.sink.records.filter((r) => r.kind === RecordKind.RestResponse);
    expect(rest.length).toBeGreaterThanOrEqual(4);
    expect(rest[0]?.payload).toMatchObject({ path: "/swagger-schema.json", status: 200 });
    const stamps = env.sink.records.filter(
      (r) =>
        r.kind === RecordKind.Marker && (r.payload as { label: string }).label === "lmu-game-info",
    );
    expect(stamps).toHaveLength(1);
  });
});

describe("LMU REST client", () => {
  const clock = new FakeClock();
  const never: FetchLike = async () => {
    throw new Error("must not be called");
  };

  it("throws on any non-GET call", async () => {
    const client = new LmuRestClient(clock, never);
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD", "get"]) {
      await expect(client.request(method, "/navigation/state")).rejects.toBeInstanceOf(
        RestRequestRejected,
      );
    }
  });

  it("throws on getVehicleCondition even if it were allowlisted", async () => {
    const client = new LmuRestClient(clock, never);
    await expect(client.get("/rest/garage/getVehicleCondition")).rejects.toThrow(/Forbidden/);
    await expect(client.get("/rest/garage/GETVEHICLECONDITION")).rejects.toThrow(/Forbidden/);
    expect(LMU_REST_ALLOWLIST.some((p) => /vehiclecondition/i.test(p))).toBe(false);
  });

  it("throws on paths outside the allowlist", async () => {
    const client = new LmuRestClient(clock, never);
    await expect(client.get("/rest/garage/drive")).rejects.toThrow(/allowlist/);
    await expect(client.get("/navigation/state?x=1")).rejects.toThrow(/allowlist/);
    await expect(client.get("/rest/garage/PitMenu/loadPitMenu")).rejects.toThrow(/allowlist/);
  });

  it("returns status, latency and body for an allowed GET, and status 0 on failure", async () => {
    const seen: string[] = [];
    const ok = new LmuRestClient(clock, async (url, init) => {
      seen.push(`${init.method} ${url}`);
      return { status: 200, text: async () => '{"a":1}' };
    });
    expect(await ok.get("/navigation/state")).toMatchObject({
      path: "/navigation/state",
      status: 200,
      body: { a: 1 },
    });
    expect(seen).toEqual(["GET http://127.0.0.1:6397/navigation/state"]);

    const failing = new LmuRestClient(clock, async () => {
      throw new Error("refused");
    });
    expect(await failing.get("/navigation/state")).toMatchObject({ status: 0 });
  });
});

// ---- Controller -------------------------------------------------------------------------------

class StubCap implements SimCapture {
  live = false;
  isOpen = true;
  frames = 0;
  began = 0;
  markers = 0;
  constructor(readonly sim: SimId) {}
  async probe(): Promise<void> {}
  headerExtras(): Record<string, unknown> {
    return {};
  }
  async beginFile(): Promise<void> {
    this.began++;
  }
  async step(): Promise<void> {}
  onMarker(): void {
    this.markers++;
  }
  async endFile(): Promise<Record<string, unknown>> {
    return {};
  }
  close(): void {
    this.isOpen = false;
    this.live = false;
  }
}

function controllerEnv() {
  const clock = new FakeClock();
  const opened: { sim: SimId; header: HeaderFields; summary?: Record<string, unknown> }[] = [];
  const sinks: CollectingSink[] = [];
  const files: FixtureFileFactory = {
    async open(sim, header) {
      const entry: (typeof opened)[number] = { sim, header };
      opened.push(entry);
      const sink = new CollectingSink();
      sinks.push(sink);
      return {
        path: `/fixtures/${sim}-${opened.length}.ovfx`,
        sink,
        sizeBytes: () => 123,
        close: async (summary) => {
          entry.summary = summary;
        },
      };
    },
  };
  const iracing = new StubCap("iracing");
  const lmu = new StubCap("lmu");
  const controller = new CaptureController({
    clock,
    caps: [iracing, lmu],
    files,
    appVersion: "1.2.3",
    os: "test",
  });
  return { clock, opened, sinks, iracing, lmu, controller };
}

describe("capture controller", () => {
  it("opens no file until a sim is live, then stamps the header", async () => {
    const env = controllerEnv();
    env.controller.start();
    await env.controller.tick();
    expect(env.opened).toHaveLength(0);
    expect(env.controller.status().recording).toBe(true);

    env.iracing.live = true;
    env.clock.advance(2000);
    await env.controller.tick();
    expect(env.opened).toHaveLength(1);
    expect(env.opened[0]?.header).toMatchObject({
      sim: "iracing",
      appVersion: "1.2.3",
      captureToolVersion: "1",
      os: "test",
    });
    expect(env.controller.status()).toMatchObject({ sim: "iracing", sizeBytes: 123 });
  });

  it("rotates the file after 60 minutes", async () => {
    const env = controllerEnv();
    env.iracing.live = true;
    env.controller.start();
    await env.controller.tick();
    expect(env.opened).toHaveLength(1);

    env.clock.advance(ROTATE_AFTER_MS - 1000);
    await env.controller.tick();
    expect(env.opened).toHaveLength(1);

    env.clock.advance(1000);
    await env.controller.tick();
    expect(env.opened).toHaveLength(2);
    expect(env.opened[0]?.summary).toMatchObject({ reason: "rotated" });
    expect(env.opened[1]?.sim).toBe("iracing");
    expect(env.iracing.began).toBe(2);
  });

  it("starts a new file when the sim changes", async () => {
    const env = controllerEnv();
    env.iracing.live = true;
    env.controller.start();
    await env.controller.tick();

    env.iracing.live = false;
    env.lmu.live = true;
    env.clock.advance(2000);
    await env.controller.tick();
    expect(env.opened.map((o) => o.sim)).toEqual(["iracing", "lmu"]);
    expect(env.opened[0]?.summary).toMatchObject({ reason: "sim-changed" });
    expect(env.controller.status().sim).toBe("lmu");
  });

  it("closes the file when the sim has ended and its handles are released", async () => {
    const env = controllerEnv();
    env.lmu.live = true;
    env.controller.start();
    await env.controller.tick();
    env.lmu.live = false;
    env.lmu.isOpen = false;
    env.clock.advance(2000);
    await env.controller.tick();
    expect(env.opened[0]?.summary).toMatchObject({ reason: "sim-ended" });
    expect(env.controller.status().file).toBeNull();
  });

  it("writes markers into the open file and asks the sim for a burst", async () => {
    const env = controllerEnv();
    env.lmu.live = true;
    env.controller.start();
    await env.controller.tick();
    expect(await env.controller.marker("pit stop")).toBe(true);
    const marker = env.sinks[0]?.records.find((r) => r.kind === RecordKind.Marker);
    expect(marker?.payload).toMatchObject({ label: "pit stop", sim: "lmu" });
    expect(env.lmu.markers).toBe(1);
    await env.controller.stop();
    expect(await env.controller.marker("late")).toBe(false);
    expect(env.opened[0]?.summary).toMatchObject({ reason: "stopped" });
  });
});
