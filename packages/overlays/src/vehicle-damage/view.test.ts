import { describe, expect, it } from "vitest";
import { damage, damageFrame } from "./testing";
import {
  areaSeverity,
  damageStatus,
  damageView,
  isClean,
  SAMPLE_DAMAGE_VIEW,
  severityOf,
  sinceText,
  tyresText,
  type DamageView,
} from "./view";

function viewOf(dents: number[], flat: Parameters<typeof damage>[1] = {}): DamageView {
  const v = damageView(damageFrame(damage(dents, flat)));
  if (v === null) throw new Error("no view");
  return v;
}

const status = (dents: number[], flat: Parameters<typeof damage>[1] = {}) =>
  damageStatus(viewOf(dents, flat));

describe("severityOf", () => {
  it("maps the sim's dent levels: 0 ok, 1 minor, 2 and up heavy", () => {
    expect(severityOf(0)).toBe("ok");
    expect(severityOf(1)).toBe("minor");
    expect(severityOf(2)).toBe("heavy");
    expect(severityOf(3)).toBe("heavy");
  });

  it("treats junk as no damage", () => {
    expect(severityOf(-1)).toBe("ok");
    expect(severityOf(Number.NaN)).toBe("ok");
    expect(severityOf(0.5)).toBe("ok");
  });
});

describe("damageView", () => {
  it("names the eight zones in the sim's order, round from the nose through the left", () => {
    const v = viewOf([1, 2, 0, 0, 1, 0, 2, 0]);
    expect(v.zones).toEqual({
      front: "minor",
      frontLeft: "heavy",
      left: "ok",
      rearLeft: "ok",
      rear: "minor",
      rearRight: "ok",
      right: "heavy",
      frontRight: "ok",
    });
  });

  it("gives the seconds since the last impact on the session clock", () => {
    expect(damageView(damageFrame(damage([], {}, 388.4), 400))?.sinceImpactS).toBeCloseTo(11.6);
    expect(damageView(damageFrame(damage([], {}, null), 400))?.sinceImpactS).toBeNull();
    // The impact time can run a tick ahead of the scoring clock.
    expect(damageView(damageFrame(damage([], {}, 400.1), 400))?.sinceImpactS).toBe(0);
  });

  it("is null without damage data or a live frame", () => {
    expect(damageView(null)).toBeNull();
    expect(damageView(damageFrame(null))).toBeNull();
    const stale = damageFrame(damage());
    stale.status = "waiting";
    expect(damageView(stale)).toBeNull();
  });
});

describe("damageStatus", () => {
  it("says NO DAMAGE on a clean car", () => {
    expect(status([])).toEqual({ text: "NO DAMAGE", tone: "ok" });
    expect(isClean(viewOf([]))).toBe(true);
  });

  it("names the worst level and the one area the dents are in", () => {
    expect(status([1])).toEqual({ text: "MINOR FRONT", tone: "minor" });
    expect(status([0, 0, 0, 0, 2])).toEqual({ text: "HEAVY REAR", tone: "heavy" });
    expect(status([0, 0, 1])).toEqual({ text: "MINOR SIDE", tone: "minor" });
    // Corner zones count as front or rear.
    expect(status([0, 0, 0, 0, 0, 0, 0, 1])).toEqual({ text: "MINOR FRONT", tone: "minor" });
    expect(status([0, 0, 0, 2, 1])).toEqual({ text: "HEAVY REAR", tone: "heavy" });
  });

  it("says BODY when the dents are in more than one area", () => {
    expect(status([1, 0, 0, 0, 1])).toEqual({ text: "MINOR BODY", tone: "minor" });
    // The recorded crash: nose, left rear quarter and tail.
    expect(status([2, 0, 0, 2, 2])).toEqual({ text: "HEAVY BODY", tone: "heavy" });
  });

  it("puts a flat tyre first, unless the body is heavily damaged too", () => {
    expect(status([], { rl: true })).toEqual({ text: "FLAT TYRE", tone: "heavy" });
    expect(status([1], { rl: true })).toEqual({ text: "FLAT TYRE", tone: "heavy" });
    expect(status([], { fl: true, rr: true })).toEqual({ text: "FLAT TYRES", tone: "heavy" });
    expect(status([2], { rl: true })).toEqual({ text: "HEAVY DAMAGE", tone: "heavy" });
    expect(isClean(viewOf([], { rl: true }))).toBe(false);
  });
});

describe("areas and texts", () => {
  it("takes the worst zone of an area", () => {
    const v = viewOf([0, 1, 0, 2, 0, 0, 0, 0]);
    expect(areaSeverity(v.zones, "front")).toBe("minor");
    expect(areaSeverity(v.zones, "rear")).toBe("heavy");
    expect(areaSeverity(v.zones, "side")).toBe("ok");
  });

  it("formats the last hit and the tyres", () => {
    expect(sinceText(null)).toBe("--");
    expect(sinceText(12.9)).toBe("12 s ago");
    expect(sinceText(185)).toBe("3 min ago");
    expect(tyresText({ fl: false, fr: false, rl: false, rr: false })).toBe("OK");
    expect(tyresText({ fl: true, fr: false, rl: true, rr: false })).toBe("FL RL flat");
  });

  it("samples the design's minor knock to the nose", () => {
    expect(damageStatus(SAMPLE_DAMAGE_VIEW)).toEqual({ text: "MINOR FRONT", tone: "minor" });
  });
});
