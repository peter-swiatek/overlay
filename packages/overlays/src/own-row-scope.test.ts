/**
 * Own-row scope guard.
 *
 * Only the Leaderboard, Relative, Battle Box and Garage 61 overlays may mark an own row:
 * `isOwnRow` (passed to DataTable) and the `ov-row--own` class may appear only inside the
 * directories `leaderboard/`, `relative/`, `battle-box/` and `garage-61/` of this package.
 * `shared/` is not exempt. Test files are not scanned.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ["leaderboard", "relative", "battle-box", "garage-61"];
const SOURCE = /\.(ts|tsx|css)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("own-row scope", () => {
  it("only the leaderboard, relative, battle-box and garage-61 overlays mark an own row", () => {
    const offenders = files(ROOT)
      .filter((f) => SOURCE.test(f) && !TEST_FILE.test(f))
      .map((f) => relative(ROOT, f))
      .filter((f) => !ALLOWED.includes(f.split(sep)[0] ?? ""))
      .filter((f) => /isOwnRow|ov-row--own/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(
      offenders,
      `${offenders.join(", ")}: only the Leaderboard, Relative, Battle Box and Garage 61 overlays (directories ${ALLOWED.join(", ")}) may mark an own row`,
    ).toEqual([]);
  });
});
