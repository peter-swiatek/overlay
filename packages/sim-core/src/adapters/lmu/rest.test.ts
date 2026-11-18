import { describe, expect, it } from "vitest";
import { applyRestResponse, emptyRestSnapshot, LMU_REPAIR_PATH, parseRepairDamage } from "./rest";

/** The repair screen body's shape, cut down to the part we read. */
const repairBody = (aero: unknown, suspension: unknown) => ({
  fuelInfo: { currentFuel: 88 },
  wearables: {
    body: { aero },
    brakes: [0.034, 0.034, 0.032, 0.032],
    suspension,
    tires: [1, 1, 0, 1],
  },
});

describe("parseRepairDamage", () => {
  it("reads aero and per-corner suspension damage as fractions", () => {
    expect(parseRepairDamage(repairBody(0.0533, [0.0571, 0, 0.1377, 0]))).toEqual({
      aero: 0.0533,
      suspension: { fl: 0.0571, fr: 0, rl: 0.1377, rr: 0 },
    });
  });

  it("drops values that do not look like fractions", () => {
    expect(parseRepairDamage(repairBody(2, [0, 0, 0, 0]))).toEqual({
      aero: null,
      suspension: { fl: 0, fr: 0, rl: 0, rr: 0 },
    });
    expect(parseRepairDamage(repairBody(0.1, [0, 0, 0]))).toEqual({ aero: 0.1, suspension: null });
    expect(parseRepairDamage(repairBody(0.1, [0, "x", 0, 0]))?.suspension).toBeNull();
    expect(parseRepairDamage(repairBody(null, null))).toBeNull();
    expect(parseRepairDamage({})).toBeNull();
    expect(parseRepairDamage("nope")).toBeNull();
  });
});

describe("applyRestResponse with the repair screen", () => {
  const ok = { path: LMU_REPAIR_PATH, status: 200, body: repairBody(0.05, [0, 0, 0.1, 0]) };

  it("keeps the damage of a good body, also when it arrives as text", () => {
    const a = applyRestResponse(emptyRestSnapshot(), ok);
    expect(a.damage?.aero).toBe(0.05);
    const b = applyRestResponse(emptyRestSnapshot(), { ...ok, body: JSON.stringify(ok.body) });
    expect(b.damage).toEqual(a.damage);
  });

  it("clears the damage when a request fails, so it is never shown stale", () => {
    const a = applyRestResponse(emptyRestSnapshot(), ok);
    expect(applyRestResponse(a, { path: LMU_REPAIR_PATH, status: 0, body: {} }).damage).toBeNull();
    expect(applyRestResponse(a, { ...ok, body: "<html>" }).damage).toBeNull();
  });

  it("leaves the damage alone for other paths", () => {
    const a = applyRestResponse(emptyRestSnapshot(), ok);
    const b = applyRestResponse(a, { path: "/rest/watch/standings", status: 0, body: null });
    expect(b.damage).toEqual(a.damage);
  });
});
