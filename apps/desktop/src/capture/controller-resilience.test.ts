import { createReadStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordKind, readAllRecords, type SimId } from "@overlay/sim-core";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureController, type FixtureFileFactory } from "./controller";
import { FakeClock, FakeMapping, FakeSharedMemory } from "./fakes";
import { createFixtureFileFactory } from "./file-sink";
import { LMU_DATA_NAME, LmuCapture } from "./lmu";
import { LmuRestClient, type FetchLike } from "./rest-client";
import type { RecordSink, SimCapture } from "./sim-capture";

describe("LMU load screen mid-recording", () => {
  it("keeps the same file when LMU is silent for 6 s and then resumes", async () => {
    const clock = new FakeClock();
    const shm = new FakeSharedMemory();
    shm.mappings.set(LMU_DATA_NAME, new FakeMapping(Buffer.alloc(4096)));
    let up = true;
    const fetchFn: FetchLike = async () => {
      if (!up) throw new Error("connection refused");
      return { status: 200, text: async () => '{"state":{"appBuild":1}}' };
    };
    const lmu = new LmuCapture(shm, new LmuRestClient(clock, fetchFn), clock);
    const records: { kind: number }[] = [];
    let opened = 0;
    const files: FixtureFileFactory = {
      async open() {
        opened++;
        const sink: RecordSink = {
          write: async (kind) => {
            records.push({ kind });
          },
        };
        return { path: "f", sink, sizeBytes: () => 0, close: async () => {} };
      },
    };
    const controller = new CaptureController({
      clock,
      caps: [lmu],
      files,
      appVersion: "1",
      os: "t",
    });
    controller.start();
    await controller.tick();
    await lmu.settled();
    expect(opened).toBe(1);

    up = false;
    for (let i = 0; i < 3; i++) {
      clock.advance(2000);
      await controller.tick();
      await lmu.settled();
    }
    expect(lmu.live).toBe(false);
    expect(lmu.isOpen).toBe(true);
    expect(opened).toBe(1);

    up = true;
    const before = records.filter((r) => r.kind === RecordKind.LmuBuffer).length;
    clock.advance(2000);
    await controller.tick(); // probe heartbeat answers: live again
    clock.advance(1000);
    await controller.tick();
    await lmu.settled();
    expect(lmu.live).toBe(true);
    expect(opened).toBe(1);
    expect(records.filter((r) => r.kind === RecordKind.LmuBuffer).length).toBeGreaterThan(before);
  });
});

describe("stop during an in-flight tick", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("finishes the tick, closes cleanly and leaves a valid file ending in the summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stop-"));
    dirs.push(dir);
    const clock = new FakeClock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inStep = new Promise<void>((resolve) => (entered = resolve));
    let sink: RecordSink | undefined;
    const cap: SimCapture = {
      sim: "lmu" as SimId,
      live: true,
      isOpen: true,
      frames: 0,
      probe: async () => {},
      headerExtras: () => ({}),
      beginFile: async (s) => {
        sink = s;
      },
      step: async () => {
        entered();
        await gate; // the tick is still running when stop is requested
        await sink?.write(RecordKind.LmuBuffer, Buffer.alloc(1000, 3));
      },
      onMarker: () => {},
      endFile: async () => ({}),
      close: () => {},
    };
    const controller = new CaptureController({
      clock,
      caps: [cap],
      files: createFixtureFileFactory(dir, clock),
      appVersion: "1",
      os: "t",
    });
    controller.start();
    const loop = controller.runLoop(async () => {});
    await inStep;
    const stopping = controller.requestStop();
    release();
    await stopping;
    await loop;

    const status = controller.status();
    expect(status.error).toBeNull();
    expect(status.recording).toBe(false);
    const file = status.file;
    expect(file).toBeNull();

    const { readdirSync } = await import("node:fs");
    const name = readdirSync(dir)[0] ?? "";
    const { reader, records } = await readAllRecords(createReadStream(join(dir, name)));
    expect(records.at(-1)?.kind).toBe(RecordKind.Summary);
    expect(records.some((r) => r.kind === RecordKind.LmuBuffer)).toBe(true);
    expect(reader.truncated).toBe(false);
  });
});
