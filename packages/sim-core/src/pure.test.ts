import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/** The only modules the pure entry may reach, relative to src. */
const ALLOWED = new Set([
  "pure.ts",
  "calc/fuel/formulas.ts",
  "calc/fuel/types.ts",
  "model/class-colours.ts",
]);

/** Module specifiers of imports, `export … from` and bare `import "x"`, across lines. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  const re = /(?:\bimport|\bexport)\s+(?:[^"';]*?\bfrom\s*)?["']([^"']+)["']/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push(m[1]!);
  return out;
}

function walk(file: string, seen: Set<string>, problems: string[]): void {
  if (seen.has(file)) return;
  seen.add(file);
  const rel = file.slice(SRC.length + 1).replaceAll("\\", "/");
  if (!ALLOWED.has(rel)) problems.push(`${rel} is not an allowed module`);
  const text = readFileSync(file, "utf8");
  for (const spec of specifiers(text)) {
    if (spec.startsWith("node:")) problems.push(`${rel} imports ${spec}`);
    else if (spec.startsWith(".")) walk(resolve(dirname(file), `${spec}.ts`), seen, problems);
    else problems.push(`${rel} imports package ${spec}`);
  }
}

describe("@overlay/sim-core/pure", () => {
  it("reaches no Node module and nothing outside the allowed files", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    walk(resolve(SRC, "pure.ts"), seen, problems);
    expect(problems).toEqual([]);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("the specifier scan sees multi-line and side-effect imports", () => {
    const text = 'import {\n  a,\n} from "node:fs";\nimport "node:os";\nexport * from "./x";';
    expect(specifiers(text)).toEqual(["node:fs", "node:os", "./x"]);
  });
});

describe("@overlay/sim-core/types", () => {
  it("contains only type exports", () => {
    const lines = readFileSync(resolve(SRC, "types.ts"), "utf8")
      .split("\n")
      .filter((l) => /^\s*(export|import)\b/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^\s*(export|import) type\b/);
  });
});
