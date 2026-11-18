import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilePitExitStore, parsePitExitFile, pitExitFile } from "./pit-exit-store";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "overlay-pitexit-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("FilePitExitStore", () => {
  it("keeps exits in userData/pit-exits.json and reads them after a restart", async () => {
    const userData = tempDir();
    const file = pitExitFile(userData);
    expect(file).toBe(join(userData, "pit-exits.json"));
    const store = new FilePitExitStore(file);
    expect(store.load("iracing_ring")).toBeNull();
    store.save("iracing_ring", 0.0123);
    expect(store.load("iracing_ring")).toBe(0.0123);
    await store.idle();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      version: 1,
      exits: { iracing_ring: 0.0123 },
    });
    expect(new FilePitExitStore(file).load("iracing_ring")).toBe(0.0123);
  });

  it("ignores out-of-range saves and reads a bad file as empty", () => {
    const userData = tempDir();
    const file = pitExitFile(userData);
    writeFileSync(file, "{not json");
    const store = new FilePitExitStore(file);
    store.save("a", 1.2);
    store.save("b", Number.NaN);
    expect(store.load("a")).toBeNull();
    expect(store.load("b")).toBeNull();
  });

  it("keeps valid entries only", () => {
    expect(parsePitExitFile({ version: 1, exits: { a: 0.5, b: 2, c: "x", d: -1 } })).toEqual({
      version: 1,
      exits: { a: 0.5 },
    });
    expect(parsePitExitFile(null)).toEqual({ version: 1, exits: {} });
  });
});
