import { createReadStream, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LMU_MAX_VEHICLES,
  PATHS,
  RESULTS_STREAM,
  SCORING_BASE,
  SESSION,
  VEHICLE,
  VEHICLE_ROWS_OFFSET,
  VEHICLE_STRIDE,
} from "../adapters/lmu/layout";
import { RecordKind } from "./format";
import { LmuRedactor } from "./redact";
import { FixtureReader } from "./reader";

const dir = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));
const files = readdirSync(dir).filter((name) => name.endsWith(".ovfx"));

// Personal strings that must never appear in a committed slice.
const FORBIDDEN = ["pswia", "Swiatek", "Users/", "Users\\"];

describe("committed fixture slices", () => {
  it("has the expected slices", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps each file under 8 MB and the set under 25 MB", () => {
    const sizes = files.map((name) => statSync(`${dir}${name}`).size);
    for (const size of sizes) expect(size).toBeLessThan(8 * 1024 * 1024);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(25 * 1024 * 1024);
  });

  it.each(files)("%s is a complete, redacted slice", async (name) => {
    const reader = new FixtureReader(createReadStream(`${dir}${name}`));
    let records = 0;
    for await (const record of reader.records()) {
      records++;
      for (const word of FORBIDDEN) expect(record.payload.includes(word)).toBe(false);
    }
    expect(records).toBeGreaterThan(10);
    expect(reader.truncated).toBe(false);
    expect(reader.header?.["sliceOf"]).toBeTypeOf("string");
    expect(reader.summary?.["redacted"]).toBe(true);
  });

  it.each(files)("%s carries only synthetic ids and names", async (name) => {
    const reader = new FixtureReader(createReadStream(`${dir}${name}`));
    const redactor = new LmuRedactor();
    for await (const record of reader.records()) {
      if (
        record.kind === RecordKind.IracingHeader ||
        record.kind === RecordKind.IracingSessionYaml
      ) {
        const text = record.payload.toString("latin1");
        for (const m of text.matchAll(/^\s*(?:- )?(?:Driver)?UserID:[ \t]*(\S*)/gm)) {
          expect(m[1]).toMatch(/^9000\d\d$/);
        }
        for (const m of text.matchAll(/^\s*SessionID:[ \t]*(\S*)/gm)) expect(m[1]).toBe("700001");
        for (const m of text.matchAll(/^\s*SubSessionID:[ \t]*(\S*)/gm))
          expect(m[1]).toBe("700002");
        for (const m of text.matchAll(
          /^\s*(?:UserName|AbbrevName|Initials|TeamName):[ \t]*(.*)$/gm,
        )) {
          expect(m[1]).toMatch(/^Driver [\d?]+$/);
        }
      }
      if (record.kind === RecordKind.LmuBuffer) expectBufferRedacted(record.payload);
      if (record.kind === RecordKind.RestResponse) {
        redactor.observe(JSON.parse(record.payload.toString("utf8")));
      }
    }
    // Everything the redactor would treat as a person's name must be one of our labels
    // ("D 5" style entries are its abbreviations of those labels).
    for (const person of redactor.originalNames({ people: true })) {
      expect(person).toMatch(/^(Driver|D\.?)( \w+)?$/);
    }
  });
});

/** Every name-bearing field of an LMU_Data buffer holds only synthetic text. */
function expectBufferRedacted(payload: Buffer): void {
  const text = (offset: number, length: number): string => {
    const slice = payload.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return slice.subarray(0, end < 0 ? length : end).toString("latin1");
  };
  const count = payload.readInt32LE(SCORING_BASE + SESSION.numVehicles);
  for (let i = 0; i < LMU_MAX_VEHICLES; i++) {
    const row = VEHICLE_ROWS_OFFSET + i * VEHICLE_STRIDE;
    const driver = text(row + VEHICLE.driverName.offset, VEHICLE.driverName.length);
    if (i < count) expect(driver).toBe(`Driver ${payload.readInt32LE(row)}`);
    else expect(driver).toBe("");
    expect(payload.readBigUInt64LE(row + VEHICLE.steamId)).toBe(0n);
  }
  expect(text(SCORING_BASE + SESSION.playerName.offset, SESSION.playerName.length)).toMatch(
    /^Driver \d+$/,
  );
  expect(text(SCORING_BASE + SESSION.playerFileName.offset, 64)).toBe("player");
  for (let i = 0; i < PATHS.count; i++) {
    expect(text(PATHS.offset + i * PATHS.size, PATHS.size)).toMatch(/^(C:\\LMU\\path\d)?$/);
  }
  const stream = payload.subarray(
    RESULTS_STREAM.offset,
    RESULTS_STREAM.offset + RESULTS_STREAM.length,
  );
  expect(stream.every((byte) => byte === 0)).toBe(true);
}
