import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRecorderArgs, recorderForkArgs } from "./args";
import { monthOf, tier2RelativePath, writeManifest } from "./files";
import {
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  normalizeRetentionDays,
  pruneTelemetryFiles,
  refreshAllManifests,
} from "./retention";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 12);
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "overlay-retention-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function put(relative: string, ageDays: number, content = "x"): string {
  const path = join(root, ...relative.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  const when = new Date(NOW - ageDays * DAY);
  utimesSync(path, when, when);
  return path;
}

describe("normalizeRetentionDays", () => {
  it("defaults to 60 and never goes below 30", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(60);
    expect(MIN_RETENTION_DAYS).toBe(30);
    expect(normalizeRetentionDays(undefined)).toBe(60);
    expect(normalizeRetentionDays("90")).toBe(60);
    expect(normalizeRetentionDays(Number.NaN)).toBe(60);
    expect(normalizeRetentionDays(7)).toBe(30);
    expect(normalizeRetentionDays(-5)).toBe(30);
    expect(normalizeRetentionDays(30)).toBe(30);
    expect(normalizeRetentionDays(90.7)).toBe(90);
  });
});

describe("pruneTelemetryFiles", () => {
  it("removes tier 2 files past the limit, keeps newer ones and rewrites the manifest", () => {
    put("iracing/2026-08/old.otlm", 70);
    put("iracing/2026-10/keep-a.otlm", 59);
    put("iracing/2026-10/old-b.otlm", 61);
    put("lmu/2026-09/keep-c.otlm", 20);
    writeManifest(join(root, "iracing", "2026-10"), NOW - 1);

    const result = pruneTelemetryFiles(root, 60, NOW);
    expect(result.removed.sort()).toEqual([
      "iracing/2026-08/old.otlm",
      "iracing/2026-10/old-b.otlm",
    ]);
    expect(result.kept).toBe(2);
    expect(existsSync(join(root, "iracing", "2026-10", "keep-a.otlm"))).toBe(true);
    expect(existsSync(join(root, "iracing", "2026-10", "old-b.otlm"))).toBe(false);
    expect(existsSync(join(root, "lmu", "2026-09", "keep-c.otlm"))).toBe(true);

    const manifest = JSON.parse(
      readFileSync(join(root, "iracing", "2026-10", "manifest.json"), "utf8"),
    ) as {
      files: { file: string }[];
    };
    expect(manifest.files.map((f) => f.file)).toEqual(["keep-a.otlm"]);
  });

  it("removes a month that has nothing left, with its manifest, and nothing else", () => {
    put("iracing/2026-08/old.otlm", 90);
    writeManifest(join(root, "iracing", "2026-08"), NOW);
    put("iracing/2026-07/old.otlm", 120);
    writeFileSync(join(root, "iracing", "2026-07", "notes.txt"), "mine");
    pruneTelemetryFiles(root, 60, NOW);
    expect(existsSync(join(root, "iracing", "2026-08"))).toBe(false);
    // A directory with a file the recorder did not make stays.
    expect(existsSync(join(root, "iracing", "2026-07", "notes.txt"))).toBe(true);
  });

  it("clamps a short setting to 30 days, so a 40 day old file survives a 7 day request", () => {
    put("iracing/2026-09/a.otlm", 40);
    put("iracing/2026-09/b.otlm", 31);
    put("iracing/2026-09/c.otlm", 29);
    const result = pruneTelemetryFiles(root, 7, NOW);
    expect(result.removed.sort()).toEqual(["iracing/2026-09/a.otlm", "iracing/2026-09/b.otlm"]);
    expect(existsSync(join(root, "iracing", "2026-09", "c.otlm"))).toBe(true);
  });

  it("copes with a missing directory and ignores files that are not tier 2", () => {
    expect(pruneTelemetryFiles(join(root, "nope"), 60, NOW)).toEqual({
      removed: [],
      kept: 0,
      failed: 0,
    });
    put("iracing/2026-01/readme.txt", 400);
    expect(pruneTelemetryFiles(root, 60, NOW).removed).toEqual([]);
    expect(existsSync(join(root, "iracing", "2026-01", "readme.txt"))).toBe(true);
  });

  it("carries on past a file it cannot remove", () => {
    put("iracing/2026-08/a.otlm", 90);
    // A directory with the extension cannot be removed as a file.
    const stuck = join(root, "iracing", "2026-08", "b.otlm");
    mkdirSync(stuck);
    const old = new Date(NOW - 90 * DAY);
    utimesSync(stuck, old, old);
    put("iracing/2026-08/c.otlm", 90);
    const result = pruneTelemetryFiles(root, 60, NOW);
    expect(result.removed.sort()).toEqual(["iracing/2026-08/a.otlm", "iracing/2026-08/c.otlm"]);
    expect(result.failed).toBe(1);
  });

  it("never touches the tier 1 database that sits next to the telemetry directory", () => {
    const userData = join(root, "userData");
    mkdirSync(userData, { recursive: true });
    const db = join(userData, "overlay.db");
    writeFileSync(db, "sqlite");
    const old = new Date(NOW - 400 * DAY);
    utimesSync(db, old, old);
    const telemetry = join(userData, "telemetry");
    mkdirSync(telemetry);
    pruneTelemetryFiles(telemetry, 30, NOW);
    expect(readFileSync(db, "utf8")).toBe("sqlite");
  });
});

describe("refreshAllManifests", () => {
  it("lists files of every month, including sessions a crash cut short", () => {
    put("iracing/2026-10/crashed.otlm", 1, "123");
    put("lmu/2026-09/other.otlm", 1, "12");
    mkdirSync(join(root, "lmu", "2026-08"), { recursive: true });
    expect(refreshAllManifests(root, NOW)).toBe(2);
    const read = (p: string): { files: { file: string; bytes: number }[] } =>
      JSON.parse(readFileSync(join(root, ...p.split("/")), "utf8"));
    expect(read("iracing/2026-10/manifest.json").files).toMatchObject([
      { file: "crashed.otlm", bytes: 3 },
    ]);
    expect(read("lmu/2026-09/manifest.json").files).toMatchObject([
      { file: "other.otlm", bytes: 2 },
    ]);
    expect(existsSync(join(root, "lmu", "2026-08", "manifest.json"))).toBe(false);
  });
});

describe("paths and manifest", () => {
  it("names the file by sim, UTC month and session id", () => {
    const started = Date.UTC(2026, 11, 31, 23, 59);
    expect(monthOf(started)).toBe("2026-12");
    expect(tier2RelativePath("lmu", started, "abc")).toBe("lmu/2026-12/abc.otlm");
  });

  it("lists every tier 2 file with its size", () => {
    put("iracing/2026-10/b.otlm", 1, "12345");
    put("iracing/2026-10/a.otlm", 1, "12");
    const manifest = writeManifest(join(root, "iracing", "2026-10"), NOW);
    expect(manifest.files.map((f) => [f.file, f.bytes])).toEqual([
      ["a.otlm", 2],
      ["b.otlm", 5],
    ]);
    expect(manifest.generatedAt).toBe(NOW);
  });
});

describe("recorder fork arguments", () => {
  it("round-trip through the process arguments", () => {
    const args = recorderForkArgs({
      userData: "C:\\Users\\p\\AppData\\Roaming\\Overlay",
      retentionDays: 45,
      recordSynthetic: true,
    });
    expect(parseRecorderArgs(["/electron", "/telemetry.js", ...args])).toEqual({
      userData: "C:\\Users\\p\\AppData\\Roaming\\Overlay",
      retentionDays: 45,
      recordSynthetic: true,
    });
  });

  it("falls back to safe values", () => {
    expect(parseRecorderArgs([])).toEqual({
      userData: null,
      retentionDays: 60,
      recordSynthetic: false,
    });
    expect(parseRecorderArgs(["--retention-days=3", "--user-data="])).toEqual({
      userData: null,
      retentionDays: 30,
      recordSynthetic: false,
    });
    expect(recorderForkArgs({ userData: null, retentionDays: 3, recordSynthetic: false })).toEqual([
      "--retention-days=30",
    ]);
  });
});
