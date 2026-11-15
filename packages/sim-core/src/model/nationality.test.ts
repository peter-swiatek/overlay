import { describe, expect, it } from "vitest";
import { NATIONALITY_CODES, nationalityCode } from "./nationality";

describe("nationalityCode", () => {
  it("maps iRacing flair names to flag codes", () => {
    const cases: [string, string][] = [
      ["Australia", "au"],
      ["China", "cn"],
      ["Virgin Islands", "vi"],
      ["Dominican Republic", "do"],
      ["New Zealand", "nz"],
      ["Germany", "de"],
      ["United States", "us"],
      ["United Kingdom", "gb"],
      ["England", "gb-eng"],
      ["Scotland", "gb-sct"],
      ["Wales", "gb-wls"],
      ["Northern Ireland", "gb-nir"],
      ["Catalonia", "es-ct"],
      ["Basque Country", "es-pv"],
    ];
    for (const [name, code] of cases) expect([name, nationalityCode(name)]).toEqual([name, code]);
  });

  it("ignores case, spaces and punctuation", () => {
    expect(nationalityCode("  new ZEALAND ")).toBe("nz");
    expect(nationalityCode("Dominican-Republic")).toBe("do");
  });

  it("has no flag for no flair, Global or a name it does not know", () => {
    expect(nationalityCode("-none-")).toBeNull();
    expect(nationalityCode("Global")).toBeNull();
    expect(nationalityCode("Atlantis")).toBeNull();
    expect(nationalityCode("")).toBeNull();
    expect(nationalityCode(null)).toBeNull();
  });

  it("only returns codes in NATIONALITY_CODES", () => {
    for (const name of ["Australia", "England", "Kosovo", "Canary Islands"]) {
      const code = nationalityCode(name);
      expect(code).not.toBeNull();
      expect(NATIONALITY_CODES).toContain(code);
    }
  });
});
