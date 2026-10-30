import { describe, expect, it } from "vitest";
import { overlaysName } from "./index";

describe("overlays", () => {
  it("returns its package name", () => {
    expect(overlaysName()).toBe("@overlay/overlays");
  });
});
