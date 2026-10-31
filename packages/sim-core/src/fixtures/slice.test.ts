import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  FixtureWriter,
  RecordKind,
  parseJsonPayload,
  readAllRecords,
  sliceFixture,
  type FixtureRecord,
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

interface Source {
  at: number;
  kind: number;
  payload: Buffer | string | object;
}

async function build(sim: "iracing" | "lmu", records: Source[]): Promise<Buffer> {
  const clock = { t: 0 };
  const sink = new MemorySink();
  const header: HeaderFields = {
    sim,
    captureToolVersion: "1",
    appVersion: "0",
    os: "test",
    startedUtc: "2026-10-30T00:00:00.000Z",
    notes: "",
  };
  const writer = new FixtureWriter(sink, header, {
    clock: { monoMs: () => clock.t, wallMs: () => 1_700_000_000_000 + clock.t },
  });
  for (const r of records) {
    clock.t = r.at;
    await writer.write(r.kind, r.payload);
  }
  await writer.close();
  return sink.bytes();
}

async function* bytesOf(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield bytes;
}

async function slice(
  input: Buffer,
  fromS: number,
  toS: number,
): Promise<{
  records: FixtureRecord[];
  header: Record<string, unknown>;
  summary: Record<string, unknown>;
}> {
  const output = new MemorySink();
  await sliceFixture({
    openInput: () => bytesOf(input),
    output,
    fromS,
    toS,
    sourceName: "src.ovfx",
  });
  const { reader, records } = await readAllRecords(bytesOf(output.bytes()));
  return {
    records,
    header: reader.header as Record<string, unknown>,
    summary: reader.summary as Record<string, unknown>,
  };
}

const YAML = [
  "DriverInfo:",
  " DriverCarIdx: 1",
  " DriverUserID: 424242",
  " Drivers:",
  " - CarIdx: 0",
  "   UserName: Real Person",
  "   AbbrevName: Person, R",
  "   Initials: RP",
  "   UserID: 111111",
  "   TeamID: 0",
  "   TeamName: Real Team",
  '   CarNumber: "7"',
  " - CarIdx: 1",
  "   UserName: Peter Example",
  "   UserID: 424242",
  "   TeamID: 55",
  "WeekendInfo:",
  "  SessionID: 5551234",
  "  SubSessionID: 5559999",
  '  TelemetryDiskFile: "C /Users/someone/Documents/x.ibt"',
  "",
].join("\n");

function irsdkHeader(yaml: string): Buffer {
  const buf = Buffer.alloc(1024);
  buf.writeInt32LE(yaml.length + 50, 16);
  buf.writeInt32LE(112, 20);
  buf.write(yaml, 112, "latin1");
  return buf;
}

describe("sliceFixture on an iRacing recording", () => {
  const records: Source[] = [
    { at: 100, kind: RecordKind.IracingHeader, payload: irsdkHeader(YAML) },
    { at: 150, kind: RecordKind.IracingSessionYaml, payload: Buffer.from(YAML, "latin1") },
  ];
  for (let i = 0; i < 100; i++) {
    records.push({
      at: 1000 + i * 100,
      kind: RecordKind.IracingVarBuffer,
      payload: Buffer.from([i]),
    });
  }

  it("is self-contained, windowed and redacted", async () => {
    const input = await build("iracing", records);
    const { records: out, header, summary } = await slice(input, 4, 6);

    expect(header["sliceOf"]).toBe("src.ovfx");
    expect(header["fromS"]).toBe(4);
    expect(header["toS"]).toBe(6);
    expect(header["sim"]).toBe("iracing");

    expect(out.map((r) => r.kind).slice(0, 3)).toEqual([
      RecordKind.Header,
      RecordKind.IracingHeader,
      RecordKind.IracingSessionYaml,
    ]);
    const frames = out.filter((r) => r.kind === RecordKind.IracingVarBuffer);
    expect(frames).toHaveLength(20);
    // window is relative to the first record (the header at monoMs 0)
    expect(frames[0]?.monoMs).toBe(4000);
    expect(frames[19]?.monoMs).toBe(5900);
    // re-emitted records take the first kept frame's time
    expect(out[1]?.monoMs).toBe(4000);
    expect(out[2]?.monoMs).toBe(4000);
    expect(summary["sliceOf"]).toBe("src.ovfx");
    expect(summary["framesKept"]).toBe(20);

    const yaml = out[2]?.payload.toString("latin1") ?? "";
    expect(yaml).toContain("UserName: Driver 0");
    expect(yaml).toContain("UserName: Driver 1");
    expect(yaml).toContain("TeamID: 0");
    expect(yaml).toContain("DriverUserID: 900001");
    expect(yaml).toContain('TelemetryDiskFile: ""');
    expect(yaml).toContain("SessionID: 700001");
    expect(yaml).toContain("SubSessionID: 700002");
    expect(yaml).not.toContain("5551234");
    for (const secret of ["Real", "Person", "Peter", "111111", "424242", "someone"]) {
      expect(yaml).not.toContain(secret);
      expect(out[1]?.payload.includes(secret)).toBe(false);
    }
    expect(out[1]?.payload.length).toBe(1024);
  });

  it("does not duplicate a state record that falls inside the window", async () => {
    const input = await build("iracing", records);
    const { records: out } = await slice(input, 0, 2);
    expect(out.filter((r) => r.kind === RecordKind.IracingSessionYaml)).toHaveLength(1);
    expect(out.filter((r) => r.kind === RecordKind.IracingHeader)).toHaveLength(1);
  });
});

describe("sliceFixture on an LMU recording", () => {
  const standings = [
    { slotID: 4, driverName: "Alexandra Driver", fullTeamName: "Some Racing Team", player: true },
    { slotID: 5, driverName: "Bob Other", fullTeamName: "Other Team", player: false },
  ];
  function lmuBuffer(): Buffer {
    const buf = Buffer.alloc(512);
    buf.write("Alexandra Driver", 100, "utf8");
    buf.write("Bob Other", 300, "utf8");
    return buf;
  }
  const records: Source[] = [
    { at: 10, kind: RecordKind.Marker, payload: { label: "lmu-game-info" } },
    {
      at: 20,
      kind: RecordKind.RestResponse,
      payload: { path: "/rest/watch/standings", status: 200, latencyMs: 1, body: standings },
    },
    {
      at: 25,
      kind: RecordKind.RestResponse,
      payload: {
        path: "/rest/strategy/usage",
        status: 200,
        latencyMs: 1,
        body: { "Alexandra Driver": [{ lap: 1 }] },
      },
    },
  ];
  for (let i = 0; i < 10; i++) {
    records.push({ at: 1000 + i * 200, kind: RecordKind.LmuSync, payload: { frame: i } });
    records.push({ at: 1001 + i * 200, kind: RecordKind.LmuBuffer, payload: lmuBuffer() });
  }

  it("keeps whole sync/buffer pairs, re-emits REST state and redacts names", async () => {
    const input = await build("lmu", records);
    // window 1.1 s .. 1.7 s keeps syncs at 1.2, 1.4, 1.6
    const { records: out } = await slice(input, 1.1, 1.7);
    const kinds = out.map((r) => r.kind);
    expect(kinds.slice(0, 4)).toEqual([
      RecordKind.Header,
      RecordKind.Marker,
      RecordKind.RestResponse,
      RecordKind.RestResponse,
    ]);
    expect(kinds.filter((k) => k === RecordKind.LmuSync)).toHaveLength(3);
    expect(kinds.filter((k) => k === RecordKind.LmuBuffer)).toHaveLength(3);

    for (const r of out) {
      for (const secret of ["Alexandra", "Bob Other", "Some Racing", "Other Team"]) {
        expect(r.payload.includes(secret)).toBe(false);
      }
    }
    const usage = out
      .filter((r) => r.kind === RecordKind.RestResponse)
      .map((r) => parseJsonPayload<{ path: string; body: unknown }>(r))
      .find((r) => r.path === "/rest/strategy/usage");
    expect(Object.keys(usage?.body as object)).toEqual(["Driver 4"]);

    const buffer = out.find((r) => r.kind === RecordKind.LmuBuffer)?.payload;
    expect(buffer?.length).toBe(512);
    expect(buffer?.subarray(100, 110).toString("utf8").replace(/\0+$/, "")).toBe("Driver 4");
  });

  it("starts on a sync boundary, never on an orphan buffer", async () => {
    const input = await build("lmu", records);
    const { records: out } = await slice(input, 1.2005, 1.7);
    const frames = out.filter(
      (r) => r.kind === RecordKind.LmuSync || r.kind === RecordKind.LmuBuffer,
    );
    expect(frames[0]?.kind).toBe(RecordKind.LmuSync);
    expect(frames[0]?.monoMs).toBe(1400);
    expect(frames.map((r) => r.kind)).toEqual([
      RecordKind.LmuSync,
      RecordKind.LmuBuffer,
      RecordKind.LmuSync,
      RecordKind.LmuBuffer,
    ]);
  });

  it("writes exactly one Summary, even when the window reaches the source Summary", async () => {
    const input = await build("lmu", records);
    const { records: out, summary } = await slice(input, 0, 1000);
    expect(out.filter((r) => r.kind === RecordKind.Summary)).toHaveLength(1);
    expect(summary["sliceOf"]).toBe("src.ovfx");
  });

  it("takes a whole pair even if the buffer lands after the window end", async () => {
    const input = await build("lmu", records);
    const { records: out } = await slice(input, 1.1, 1.2005);
    const kinds = out.map((r) => r.kind);
    expect(kinds.filter((k) => k === RecordKind.LmuSync)).toHaveLength(1);
    expect(kinds.filter((k) => k === RecordKind.LmuBuffer)).toHaveLength(1);
  });
});
