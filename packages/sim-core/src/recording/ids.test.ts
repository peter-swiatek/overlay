import { describe, expect, it } from "vitest";
import { createUuidv7Generator, isUuidv7, uuidv7, uuidv7Time } from "./ids";

const fixedRandom = (bytes: Uint8Array): void => {
  bytes.fill(0xab);
};

describe("uuidv7", () => {
  it("has version 7, variant 10 and carries the time", () => {
    const id = uuidv7(1_793_000_000_123, fixedRandom);
    expect(isUuidv7(id)).toBe(true);
    expect(uuidv7Time(id)).toBe(1_793_000_000_123);
    expect(id[14]).toBe("7");
  });

  it("sorts by time", () => {
    const a = uuidv7(1_000_000_000_000);
    const b = uuidv7(1_000_000_000_001);
    expect(a < b).toBe(true);
  });

  it("is unique with the platform random source", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1_793_000_000_000)));
    expect(ids.size).toBe(1000);
  });

  it("rejects other strings", () => {
    expect(isUuidv7("not-a-uuid")).toBe(false);
    expect(isUuidv7("018b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d")).toBe(false);
  });
});

describe("createUuidv7Generator", () => {
  it("is strictly increasing within one millisecond and across a clock step back", () => {
    const next = createUuidv7Generator(fixedRandom);
    const ids = [next(5000), next(5000), next(5000), next(4000), next(5001)];
    for (let i = 1; i < ids.length; i++)
      expect((ids[i] as string) > (ids[i - 1] as string)).toBe(true);
    expect(ids.every(isUuidv7)).toBe(true);
  });

  it("moves to the next millisecond when the counter runs out", () => {
    const next = createUuidv7Generator(fixedRandom);
    let last = next(9000);
    for (let i = 0; i < 6000; i++) {
      const id = next(9000);
      expect(id > last).toBe(true);
      last = id;
    }
    expect(uuidv7Time(last)).toBeGreaterThan(9000);
  });
});
