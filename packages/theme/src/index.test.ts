import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEME_PRESETS, THEME_TOKEN_KEYS } from "./index";

describe("theme presets", () => {
  it("includes the default theme with every token as a hex colour", () => {
    const theme = THEME_PRESETS.find((t) => t.id === DEFAULT_THEME_ID);
    expect(theme).toBeDefined();
    for (const key of THEME_TOKEN_KEYS) {
      expect(theme?.tokens[key]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  });
});
