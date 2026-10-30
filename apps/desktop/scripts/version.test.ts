import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEnv, computeBuildIdentity, displayVersion, resolveBuildInfo } from "./version.mjs";

describe("computeBuildIdentity", () => {
  it("uses the tag version for a tag build that matches package.json", () => {
    expect(computeBuildIdentity({ pkgVersion: "0.1.0", tag: "v0.1.0", runNumber: 57 })).toEqual({
      version: "0.1.0",
      channel: "release",
      runNumber: 57,
      windowsVersion: "0.1.0.57",
    });
  });

  it("fails when the tag and package.json disagree", () => {
    expect(() =>
      computeBuildIdentity({ pkgVersion: "0.1.1", tag: "v0.1.0", runNumber: 1 }),
    ).toThrow(/does not match/);
  });

  it("rejects a tag that is not v<semver>", () => {
    expect(() =>
      computeBuildIdentity({ pkgVersion: "0.1.0", tag: "release-1", runNumber: 1 }),
    ).toThrow(/not of the form/);
    expect(() =>
      computeBuildIdentity({ pkgVersion: "0.1.0", tag: "v0.1.0+x", runNumber: 1 }),
    ).toThrow();
  });

  it("builds <pkg>-ci.<run> for other CI builds, never with build metadata", () => {
    const id = computeBuildIdentity({ pkgVersion: "0.1.0", runNumber: "123" });
    expect(id).toEqual({
      version: "0.1.0-ci.123",
      channel: "dev",
      runNumber: 123,
      windowsVersion: "0.1.0.123",
    });
    expect(id.version).not.toContain("+");
  });

  it("extends an existing prerelease instead of adding a second one", () => {
    expect(computeBuildIdentity({ pkgVersion: "0.2.0-rc.1", runNumber: 9 }).version).toBe(
      "0.2.0-rc.1.ci.9",
    );
  });

  it("builds <pkg>-local with run 0 when there is no run number", () => {
    expect(computeBuildIdentity({ pkgVersion: "0.1.0" })).toEqual({
      version: "0.1.0-local",
      channel: "local",
      runNumber: 0,
      windowsVersion: "0.1.0.0",
    });
  });

  it("rejects a malformed package version or run number", () => {
    expect(() => computeBuildIdentity({ pkgVersion: "1.0" })).toThrow(/not plain semver/);
    expect(() => computeBuildIdentity({ pkgVersion: "1.0.0+a" })).toThrow(/not plain semver/);
    expect(() => computeBuildIdentity({ pkgVersion: "1.0.0", runNumber: "x" })).toThrow(
      /Run number/,
    );
    expect(() => computeBuildIdentity({ pkgVersion: "1.0.0", runNumber: 70000 })).toThrow(
      /Run number/,
    );
  });

  it("uses the requested prerelease word", () => {
    expect(
      computeBuildIdentity({ pkgVersion: "0.1.0", runNumber: 4, devWord: "beta" }).version,
    ).toBe("0.1.0-beta.4");
    expect(() =>
      computeBuildIdentity({ pkgVersion: "0.1.0", runNumber: 4, devWord: "a b" }),
    ).toThrow();
  });
});

describe("displayVersion", () => {
  it("adds the sha as build metadata only for dev builds", () => {
    expect(displayVersion("0.1.0-ci.123", "dev", "abc1234")).toBe("0.1.0-ci.123+abc1234");
    expect(displayVersion("0.1.0", "release", "abc1234")).toBe("0.1.0");
    expect(displayVersion("0.1.0-local", "local", "abc1234")).toBe("0.1.0-local");
    expect(displayVersion("0.1.0-ci.1", "dev", "unknown")).toBe("0.1.0-ci.1");
  });
});

describe("buildEnv and resolveBuildInfo", () => {
  it("exports the variables the build steps read", () => {
    const now = new Date("2026-01-02T03:04:05.000Z");
    const env = buildEnv({ runNumber: 7, sha: "abc1234", now });
    expect(env).toMatchObject({
      OVERLAY_CHANNEL: "dev",
      OVERLAY_SHA: "abc1234",
      OVERLAY_BUILD_DATE: "2026-01-02T03:04:05.000Z",
      BUILD_NUMBER: "7",
    });
    expect(env.OVERLAY_VERSION).toMatch(/^\d+\.\d+\.\d+-ci\.7$/);
    expect(env.OVERLAY_WINDOWS_VERSION).toMatch(/^\d+\.\d+\.\d+\.7$/);
  });

  it("prefers CI env and falls back to a local build", () => {
    const ci = resolveBuildInfo({
      OVERLAY_VERSION: "0.1.0-ci.5",
      OVERLAY_CHANNEL: "dev",
      OVERLAY_SHA: "abc1234",
      OVERLAY_BUILD_DATE: "2026-01-01T00:00:00.000Z",
    });
    expect(ci.displayVersion).toBe("0.1.0-ci.5+abc1234");
    const local = resolveBuildInfo({});
    expect(local.channel).toBe("local");
    expect(local.version).toMatch(/-local$/);
  });
});

describe("version-cli", () => {
  const cli = join(import.meta.dirname, "version-cli.mjs");
  const run = (extra: Record<string, string>, args: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-ver-"));
    const envFile = join(dir, "env");
    try {
      const out = execFileSync(process.execPath, [cli, ...args], {
        env: { PATH: process.env.PATH ?? "", GITHUB_ENV: envFile, ...extra },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { out, file: readFileSync(envFile, "utf8") };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("writes the build env to GITHUB_ENV, preferring the PR head sha", () => {
    const { out, file } = run({
      GITHUB_REF_TYPE: "branch",
      GITHUB_RUN_NUMBER: "42",
      GITHUB_SHA: "1111111222",
      OVERLAY_PR_HEAD_SHA: "abcdef0999",
    });
    expect(file).toBe(`${out.trim()}\n`);
    expect(file).toMatch(/^OVERLAY_VERSION=\d+\.\d+\.\d+-ci\.42$/m);
    expect(file).toContain("OVERLAY_SHA=abcdef0\n");
    expect(file).toContain("BUILD_NUMBER=42\n");
  });

  it("honours --word beta", () => {
    const { file } = run({ GITHUB_REF_TYPE: "branch", GITHUB_RUN_NUMBER: "3" }, ["--word", "beta"]);
    expect(file).toMatch(/^OVERLAY_VERSION=.*-beta\.3$/m);
  });

  it("detects a tag and fails when it does not match package.json", () => {
    expect(() =>
      run({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v9.9.9", GITHUB_RUN_NUMBER: "1" }),
    ).toThrow(/does not match/);
  });
});
