import { describe, expect, it } from "vitest";
import { lmuClassColour } from "./class-colours";

describe("lmuClassColour", () => {
  it.each([
    ["Hypercar", "#E4002B"],
    ["Hyper", "#E4002B"],
    ["LMP2", "#0057B8"],
    ["LMP2_ELMS", "#0057B8"],
    ["LMP2 ELMS", "#0057B8"],
    ["LMP3", "#8A2BE2"],
    ["LMGT3", "#00A651"],
    ["GT3", "#00A651"],
    ["GTE", "#FF8200"],
    ["  hyper car ", "#E4002B"],
  ])("%s -> %s", (name, colour) => {
    expect(lmuClassColour(name)).toBe(colour);
  });

  it("returns null for unknown, empty or missing classes", () => {
    expect(lmuClassColour("Formula Zero")).toBeNull();
    expect(lmuClassColour("")).toBeNull();
    expect(lmuClassColour(null)).toBeNull();
    expect(lmuClassColour(undefined)).toBeNull();
  });
});
