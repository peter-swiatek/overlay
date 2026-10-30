import { createReadStream, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordKind, readAllRecords } from "@overlay/sim-core";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "./fakes";
import { createFixtureFileFactory } from "./file-sink";

describe("fixture file factory", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("writes a readable .ovfx named by sim and UTC time, and never overwrites", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fixtures-"));
    dirs.push(dir);
    const factory = createFixtureFileFactory(join(dir, "fixtures"), new FakeClock());
    const header = {
      sim: "lmu" as const,
      captureToolVersion: "1",
      appVersion: "0",
      os: "t",
      startedUtc: "",
      notes: "",
    };

    const a = await factory.open("lmu", header);
    await a.sink.write(RecordKind.Marker, { label: "x" });
    await a.close({ reason: "test" });
    const b = await factory.open("lmu", header);
    await b.close({});

    expect(readdirSync(join(dir, "fixtures")).sort()).toEqual([
      "lmu-20261030T100000Z-2.ovfx",
      "lmu-20261030T100000Z.ovfx",
    ]);
    const { reader, records } = await readAllRecords(createReadStream(a.path));
    expect(records.map((r) => r.kind)).toEqual([1, 8, 9]);
    expect(reader.truncated).toBe(false);
  });
});
