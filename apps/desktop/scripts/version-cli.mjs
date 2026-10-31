// Workflow entry point: prints the build env as KEY=value lines and appends them to $GITHUB_ENV.
// Runs on import (no "is main" guard, so a symlinked or wrapped invocation cannot silently skip it).
//
//   node scripts/version-cli.mjs [--word ci|beta]
//
// Reads GITHUB_REF_TYPE/GITHUB_REF_NAME, GITHUB_RUN_NUMBER, GITHUB_SHA, and OVERLAY_PR_HEAD_SHA
// (the pull request head, preferred for the displayed sha because GITHUB_SHA is a merge commit).
import { appendFileSync } from "node:fs";
import { buildEnv, gitShortSha } from "./version.mjs";

try {
  const e = process.env;
  const args = process.argv.slice(2);
  const wordAt = args.indexOf("--word");
  const env = buildEnv({
    tag: e.GITHUB_REF_TYPE === "tag" ? e.GITHUB_REF_NAME : undefined,
    runNumber: e.GITHUB_RUN_NUMBER,
    sha: (e.OVERLAY_PR_HEAD_SHA || e.GITHUB_SHA || gitShortSha()).slice(0, 7),
    devWord: wordAt >= 0 ? args[wordAt + 1] : undefined,
  });
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join("\n"));
  if (e.GITHUB_ENV) appendFileSync(e.GITHUB_ENV, `${lines.join("\n")}\n`);
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
