import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROBE_CH_COUNT } from "./useFittedFields";

describe("ch probe", () => {
  it("is as many ch wide as the measurement divides by", () => {
    const css = readFileSync(new URL("./driver-table.css", import.meta.url), "utf8");
    const block = /\.ov-ch-probe\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(block).toContain(`width: ${PROBE_CH_COUNT}ch;`);
    expect(PROBE_CH_COUNT).toBe(100);
  });
});
