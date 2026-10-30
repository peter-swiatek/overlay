import { describe, expect, it } from "vitest";
import { simCoreName } from "./index";

describe("sim-core", () => {
  it("returns its package name", () => {
    expect(simCoreName()).toBe("@overlay/sim-core");
  });
});
