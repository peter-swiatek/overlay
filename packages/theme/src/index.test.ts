import { describe, expect, it } from "vitest";
import { themeName } from "./index";

describe("theme", () => {
  it("returns its package name", () => {
    expect(themeName()).toBe("@overlay/theme");
  });
});
