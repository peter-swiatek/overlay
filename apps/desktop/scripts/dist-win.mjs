// Local Windows package: builds with the local identity (<version>-local), so the installer name
// cannot collide with a CI or release build. CI runs the same steps itself; see docs/releasing.md.
import { execFileSync } from "node:child_process";
import { buildEnv, gitShortSha } from "./version.mjs";

const env = { ...process.env, ...buildEnv({ sha: gitShortSha() }) };
const run = (args) =>
  execFileSync("pnpm", args, { env, stdio: "inherit", shell: process.platform === "win32" });

run(["run", "build"]);
run([
  "exec",
  "electron-builder",
  "--win",
  "nsis",
  "--publish",
  "never",
  `-c.extraMetadata.version=${env.OVERLAY_VERSION}`,
  `-c.buildVersion=${env.OVERLAY_WINDOWS_VERSION}`,
]);
