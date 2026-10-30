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

  it("builds <pkg>-dev.<run> for other CI builds, never with build metadata", () => {
    const id = computeBuildIdentity({ pkgVersion: "0.1.0", runNumber: "123" });
    expect(id).toEqual({
      version: "0.1.0-dev.123",
      channel: "dev",
      runNumber: 123,
      windowsVersion: "0.1.0.123",
    });
    expect(id.version).not.toContain("+");
  });

  it("extends an existing prerelease instead of adding a second one", () => {
    expect(computeBuildIdentity({ pkgVersion: "0.2.0-rc.1", runNumber: 9 }).version).toBe(
      "0.2.0-rc.1.dev.9",
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
});

describe("displayVersion", () => {
  it("adds the sha as build metadata only for dev builds", () => {
    expect(displayVersion("0.1.0-dev.123", "dev", "abc1234")).toBe("0.1.0-dev.123+abc1234");
    expect(displayVersion("0.1.0", "release", "abc1234")).toBe("0.1.0");
    expect(displayVersion("0.1.0-local", "local", "abc1234")).toBe("0.1.0-local");
    expect(displayVersion("0.1.0-dev.1", "dev", "unknown")).toBe("0.1.0-dev.1");
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
    expect(env.OVERLAY_VERSION).toMatch(/^\d+\.\d+\.\d+-dev\.7$/);
    expect(env.OVERLAY_WINDOWS_VERSION).toMatch(/^\d+\.\d+\.\d+\.7$/);
  });

  it("prefers CI env and falls back to a local build", () => {
    const ci = resolveBuildInfo({
      OVERLAY_VERSION: "0.1.0-dev.5",
      OVERLAY_CHANNEL: "dev",
      OVERLAY_SHA: "abc1234",
      OVERLAY_BUILD_DATE: "2026-01-01T00:00:00.000Z",
    });
    expect(ci.displayVersion).toBe("0.1.0-dev.5+abc1234");
    const local = resolveBuildInfo({});
    expect(local.channel).toBe("local");
    expect(local.version).toMatch(/-local$/);
  });
});
