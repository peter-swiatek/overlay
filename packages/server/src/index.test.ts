import { describe, expect, it } from "vitest";
import { serverName } from "./index";

describe("server", () => {
  it("returns its package name", () => {
    expect(serverName()).toBe("@overlay/server");
  });
});
