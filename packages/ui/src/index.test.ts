import { describe, expect, it } from "vitest";
import { uiName } from "./index";

describe("ui", () => {
  it("returns its package name", () => {
    expect(uiName()).toBe("@overlay/ui");
  });
});
