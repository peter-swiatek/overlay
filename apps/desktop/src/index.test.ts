import { describe, expect, it } from "vitest";
import { desktopName } from "./index";

describe("desktop", () => {
  it("returns its package name", () => {
    expect(desktopName()).toBe("@overlay/desktop");
  });
});
