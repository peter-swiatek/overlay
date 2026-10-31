// Computes the build identity (version, channel, Windows file version) for CI and local builds.
// Pure functions plus a small CLI used by the workflows; see docs/releasing.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * @typedef {object} BuildIdentity
 * @property {string} version Semver without build metadata. Safe for electron-builder and file names.
 * @property {"release" | "dev" | "local"} channel
 * @property {number} runNumber CI run number, 0 for local builds.
 * @property {string} windowsVersion Four-part numeric file version, major.minor.patch.run.
 */

/**
 * @param {object} input
 * @param {string} input.pkgVersion Version from apps/desktop/package.json.
 * @param {string} [input.tag] Git tag when the build is a tag push, e.g. "v0.1.0".
 * @param {number | string} [input.runNumber] CI run number. Absent for local builds.
 * @param {string} [input.devWord] Prerelease word for non-tag CI builds: "ci" (ci.yml) or "dev" (release dispatch).
 * @returns {BuildIdentity}
 */
export function computeBuildIdentity({ pkgVersion, tag, runNumber, devWord = "ci" }) {
  const pkg = SEMVER.exec(pkgVersion);
  if (!pkg || pkgVersion.includes("+")) {
    throw new Error(`apps/desktop/package.json version "${pkgVersion}" is not plain semver`);
  }
  const hasRun = runNumber !== undefined && runNumber !== "";
  const run = hasRun ? Number(runNumber) : 0;
  if (!Number.isInteger(run) || run < 0 || run > 65535) {
    throw new Error(`Run number "${runNumber}" must be an integer from 0 to 65535`);
  }
  const windowsVersion = `${pkg[1]}.${pkg[2]}.${pkg[3]}.${run}`;

  if (tag) {
    const match = /^v(.+)$/.exec(tag);
    if (!match || !SEMVER.test(match[1]) || match[1].includes("+")) {
      throw new Error(`Tag "${tag}" is not of the form v<semver>`);
    }
    if (match[1] !== pkgVersion) {
      throw new Error(
        `Tag ${tag} does not match apps/desktop/package.json version ${pkgVersion}. ` +
          "Bump the version, commit, and tag again.",
      );
    }
    return { version: pkgVersion, channel: "release", runNumber: run, windowsVersion };
  }
  if (hasRun) {
    // A prerelease version already has a dot-separated tail to extend.
    if (!/^[a-z]+$/.test(devWord)) throw new Error(`Invalid prerelease word "${devWord}"`);
    const joiner = pkg[4] ? `.${devWord}.` : `-${devWord}.`;
    return {
      version: `${pkgVersion}${joiner}${run}`,
      channel: "dev",
      runNumber: run,
      windowsVersion,
    };
  }
  return {
    version: `${pkgVersion}${pkg[4] ? ".local" : "-local"}`,
    channel: "local",
    runNumber: 0,
    windowsVersion,
  };
}

/** Version for display only. Dev builds get the short sha as semver build metadata. */
export function displayVersion(version, channel, sha) {
  return channel === "dev" && sha && sha !== "unknown" ? `${version}+${sha}` : version;
}

const here = dirname(fileURLToPath(import.meta.url));

export function readPackageVersion() {
  return JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;
}

export function gitShortSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Build info for electron-vite: explicit OVERLAY_* env (set by CI) wins, else a local build. */
export function resolveBuildInfo(env = process.env) {
  const local = computeBuildIdentity({ pkgVersion: readPackageVersion() });
  const version = env.OVERLAY_VERSION || local.version;
  const channel = env.OVERLAY_CHANNEL || (env.OVERLAY_VERSION ? "dev" : local.channel);
  const sha = env.OVERLAY_SHA || gitShortSha();
  return {
    version,
    displayVersion: displayVersion(version, channel, sha),
    sha,
    buildDate: env.OVERLAY_BUILD_DATE || new Date().toISOString(),
    channel,
  };
}

/** Environment variables the workflows export for the build and packaging steps. */
export function buildEnv({ tag, runNumber, sha, devWord, now = new Date() }) {
  const id = computeBuildIdentity({ pkgVersion: readPackageVersion(), tag, runNumber, devWord });
  return {
    OVERLAY_VERSION: id.version,
    OVERLAY_CHANNEL: id.channel,
    OVERLAY_SHA: sha,
    OVERLAY_BUILD_DATE: now.toISOString(),
    OVERLAY_WINDOWS_VERSION: id.windowsVersion,
    BUILD_NUMBER: String(id.runNumber),
  };
}
