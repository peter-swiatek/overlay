export type BuildChannel = "release" | "dev" | "local";

/** Identity of this build, embedded at build time (electron-vite `define`). */
export interface BuildInfo {
  /** Semver without build metadata, e.g. 0.1.0 or 0.1.0-dev.123. */
  version: string;
  /** For display: dev builds append +<sha>. */
  displayVersion: string;
  sha: string;
  /** UTC ISO timestamp of the build. */
  buildDate: string;
  channel: BuildChannel;
}

declare const __OVERLAY_BUILD__: BuildInfo | undefined;

/** Falls back to an "unknown" identity under vitest, where nothing is injected. */
export const BUILD_INFO: BuildInfo =
  typeof __OVERLAY_BUILD__ === "undefined"
    ? {
        version: "0.0.0-unknown",
        displayVersion: "0.0.0-unknown",
        sha: "unknown",
        buildDate: "1970-01-01T00:00:00.000Z",
        channel: "local",
      }
    : __OVERLAY_BUILD__;
