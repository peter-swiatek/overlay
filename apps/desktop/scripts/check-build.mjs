// Fails when build output required at runtime is missing.
// A sandboxed preload cannot be ESM, so it must be emitted as out/preload/index.cjs.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "out/main/index.js",
  "out/main/capture.js",
  "out/preload/index.cjs",
  "out/renderer/settings/index.html",
  "out/renderer/overlay/index.html",
  "resources/tray.ico",
];

const missing = required.filter((file) => !existsSync(join(root, file)));
if (missing.length > 0) {
  console.error(`Missing build output:\n${missing.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("Build output OK");
