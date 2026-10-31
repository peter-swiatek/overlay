export interface BuildIdentity {
  version: string;
  channel: "release" | "dev" | "local";
  runNumber: number;
  windowsVersion: string;
}
export function computeBuildIdentity(input: {
  pkgVersion: string;
  tag?: string;
  runNumber?: number | string;
  devWord?: string;
}): BuildIdentity;
export function displayVersion(version: string, channel: string, sha: string): string;
export function readPackageVersion(): string;
export function gitShortSha(): string;
export function resolveBuildInfo(env?: Record<string, string | undefined>): {
  version: string;
  displayVersion: string;
  sha: string;
  buildDate: string;
  channel: "release" | "dev" | "local";
};
export function buildEnv(input: {
  tag?: string;
  runNumber?: number | string;
  sha: string;
  devWord?: string;
  now?: Date;
}): Record<string, string>;
