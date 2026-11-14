import { contrastRatio, LOCKED_COLOURS } from "@overlay/theme";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_NAME_COLOURS,
  MIN_NAME_CONTRAST,
  NAME_BACKDROP,
  fallbackNameColour,
  nameColour,
  nameHash,
  readableNameColour,
  sanitiseHexColour,
} from "./colour";

describe("name colours", () => {
  it("accepts only #rrggbb", () => {
    expect(sanitiseHexColour("#1E90FF")).toBe("#1e90ff");
    for (const bad of ["", "red", "#fff", "#1e90ffcc", "1e90ff", "#1e90fg", "url(x)", null, 5]) {
      expect(sanitiseHexColour(bad)).toBeNull();
    }
  });

  it("keeps colours that read on the panel", () => {
    expect(readableNameColour("#ff7f50")).toBe("#ff7f50");
    expect(readableNameColour("#ffffff")).toBe("#ffffff");
  });

  it("lightens dark colours until they read, keeping the hue", () => {
    for (const dark of ["#000000", "#0000ff", "#1a0033", "#8a2be2", "#b22222"]) {
      const out = readableNameColour(dark);
      expect(out).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(out, NAME_BACKDROP)).toBeGreaterThanOrEqual(MIN_NAME_CONTRAST);
    }
    const blue = readableNameColour("#0000ff");
    expect(parseInt(blue.slice(5, 7), 16)).toBe(255);
    expect(parseInt(blue.slice(1, 3), 16)).toBeLessThan(200);
  });

  it("gives names without a colour a palette colour, the same each time", () => {
    for (const c of FALLBACK_NAME_COLOURS) {
      expect(Object.values(LOCKED_COLOURS)).toContain(c);
    }
    expect(fallbackNameColour("apex_otter")).toBe(fallbackNameColour("Apex_Otter"));
    const picks = new Set(
      ["a_1", "b_2", "c_3", "d_4", "e_5", "f_6", "g_7", "h_8"].map(fallbackNameColour),
    );
    expect(picks.size).toBeGreaterThan(2);
    expect(nameHash("abc")).toBe(nameHash("abc"));
    expect(nameHash("abc")).not.toBe(nameHash("abd"));
  });

  it("draws every name in a readable colour", () => {
    expect(nameColour("#ff7f50", "x")).toBe("#ff7f50");
    expect(nameColour("javascript:x", "someone")).toBe(
      readableNameColour(fallbackNameColour("someone")),
    );
    expect(nameColour(null, "someone")).toBe(nameColour(undefined, "someone"));
    expect(contrastRatio(nameColour("#000001", "x"), NAME_BACKDROP)).toBeGreaterThanOrEqual(
      MIN_NAME_CONTRAST,
    );
  });
});
