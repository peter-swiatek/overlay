import { createReadStream, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
});
