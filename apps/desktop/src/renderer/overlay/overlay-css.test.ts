import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("overlay.css", () => {
  it("keeps the metrics probe out of the document width", () => {
    const css = readFileSync(new URL("./overlay.css", import.meta.url), "utf8");
    const block = /\.ov-metrics-probe\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(block).toContain("width: 0;");
    expect(block).toContain("overflow: hidden;");
  });
});
