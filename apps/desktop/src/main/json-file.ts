import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Reads JSON; returns undefined when the file is missing or unparsable. A file that exists but
 * does not parse is renamed to `<name>.bad-<timestamp>` (and logged) so the next save does not
 * overwrite what the user had.
 */
export function readJsonFile(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const backup = `${file}.bad-${Date.now()}`;
    try {
      renameSync(file, backup);
      console.error(`Could not parse ${file}; moved it to ${backup}`);
    } catch (error) {
      console.error(`Could not parse ${file}, and could not move it aside`, error);
    }
    return undefined;
  }
}

/** Atomic write: write a temp file next to the target, then rename over it. */
export function writeJsonFileAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}
