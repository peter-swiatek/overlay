import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { outlineFor } from "./testing";
import { FileTrackOutlineStore, parseUserDataArg, trackOutlineDir } from "./track-store";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "overlay-tracks-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseUserDataArg", () => {
  it("reads --user-data=<path>, keeping any = inside the path", () => {
    expect(parseUserDataArg(["--foo", "--user-data=C:\\Users\\a b\\x"])).toBe("C:\\Users\\a b\\x");
    expect(parseUserDataArg(["--user-data=/a=b"])).toBe("/a=b");
  });

  it("is null when the argument is missing or empty", () => {
    expect(parseUserDataArg([])).toBeNull();
    expect(parseUserDataArg(["--user-data="])).toBeNull();
    expect(parseUserDataArg(["--user-data", "/x"])).toBeNull();
  });
});

describe("FileTrackOutlineStore", () => {
  it("keeps outlines in userData/tracks, one file per key, and reads them back", async () => {
    const userData = tempDir();
    const dir = trackOutlineDir(userData);
    expect(dir).toBe(join(userData, "tracks"));
    const store = new FileTrackOutlineStore(dir);
    expect(store.load("iracing_ring")).toBeNull();
    const outline = outlineFor("iracing_ring");
    store.save(outline);
    await store.idle();
    expect(readdirSync(dir)).toEqual(["iracing_ring.json"]);
    expect(store.load("iracing_ring")).toEqual(outline);
    // A new store (a new run of the app) finds it too.
    expect(new FileTrackOutlineStore(dir).load("iracing_ring")).toEqual(outline);
  });

  it("returns null for a damaged or foreign file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "iracing_bad.json"), "{ not json");
    writeFileSync(join(dir, "iracing_odd.json"), JSON.stringify({ trackKey: "iracing_odd" }));
    const store = new FileTrackOutlineStore(dir);
    expect(store.load("iracing_bad")).toBeNull();
    expect(store.load("iracing_odd")).toBeNull();
  });

  it("never reads or writes outside its folder", async () => {
    const dir = join(tempDir(), "tracks");
    mkdirSync(dir);
    const errors: string[] = [];
    const store = new FileTrackOutlineStore(dir, (m) => errors.push(m));
    expect(store.load("../settings")).toBeNull();
    expect(store.load("a/b")).toBeNull();
    store.save(outlineFor("../escape"));
    await store.idle();
    expect(readdirSync(join(dir, ".."))).toEqual(["tracks"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reports a write failure instead of throwing", async () => {
    const base = tempDir();
    // A file where the folder should be.
    writeFileSync(join(base, "tracks"), "x");
    const errors: string[] = [];
    const store = new FileTrackOutlineStore(join(base, "tracks"), (m) => errors.push(m));
    store.save(outlineFor("iracing_ring"));
    await store.idle();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("iracing_ring");
  });

  it("does not block the caller, writes compact JSON and lets the latest outline win", async () => {
    const dir = join(tempDir(), "tracks");
    const store = new FileTrackOutlineStore(dir);
    store.save(outlineFor("iracing_ring", 5000));
    store.save(outlineFor("iracing_ring", 5100));
    store.save(outlineFor("iracing_ring", 5200));
    // Nothing is on disk yet: the write is asynchronous.
    expect(store.load("iracing_ring")).toBeNull();
    await store.idle();
    expect(store.load("iracing_ring")?.lengthM).toBe(5200);
    expect(readdirSync(dir)).toEqual(["iracing_ring.json"]);
    expect(readFileSync(join(dir, "iracing_ring.json"), "utf8")).not.toContain("\n");
  });
});
