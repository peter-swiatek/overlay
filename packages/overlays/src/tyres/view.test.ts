import { describe, expect, it } from "vitest";
import { designTyres, tyreCorner, tyresFrame } from "./testing";
import {
  compoundFamily,
  compoundInitial,
  compoundPill,
  SAMPLE_TYRES_VIEW,
  tempBand,
  tempsLeftToRight,
  treadBand,
  tyresView,
} from "./view";

const WINDOW = { coldBelowC: 70, hotAboveC: 95, overheatAboveC: 105 };

describe("tyresView", () => {
  it("is null without a live frame or tyres", () => {
    expect(tyresView(null)).toBeNull();
    const f = tyresFrame();
    f.status = "waiting";
    expect(tyresView(f)).toBeNull();
    expect(tyresView(tyresFrame(null))).toBeNull();
  });

  it("gives compound, laps on set, tread left and both temperature layers", () => {
    const v = tyresView(tyresFrame());
    for (const c of Object.values(v?.corners ?? {})) expect(c.compound).toBe("Medium");
    expect(v?.lapsOnSet).toBe(15);
    expect(v?.corners.fl.tread).toBeCloseTo(0.93, 6);
    expect(v?.corners.fl.surface).toEqual({ inner: 97, middle: 94, outer: 90 });
    expect(v?.corners.fl.innerLayer).toEqual({ inner: 94, middle: 91, outer: 87 });
    expect(v?.corners.fr.pressureKpa).toBe(174);
    expect(v?.corners.fr.brakeC).toBe(510);
  });

  it("copes with a state recorded before the newer tyre fields", () => {
    const t = designTyres();
    delete t.frontCompound;
    delete t.rearCompound;
    for (const c of [t.fl, t.fr, t.rl, t.rr]) delete c.compound;
    delete t.fl.innerLayerTemps;
    delete t.fl.brakeTempC;
    t.fl.wear = null;
    const f = tyresFrame(t);
    // An older frame has no tyre stint either.
    delete (f.derived as { tyreStint?: unknown }).tyreStint;
    const v = tyresView(f);
    expect(v?.corners.fl.compound).toBeNull();
    expect(v?.lapsOnSet).toBeNull();
    expect(v?.corners.fl.innerLayer).toBeNull();
    expect(v?.corners.fl.brakeC).toBeNull();
    expect(v?.corners.fl.tread).toBeNull();
  });

  it("gives each tyre its own compound, or its axle's when the state has none per tyre", () => {
    const t = designTyres();
    t.fr.compound = "Soft";
    const mixed = tyresView(tyresFrame(t))?.corners;
    expect([mixed?.fl, mixed?.fr, mixed?.rl, mixed?.rr].map((c) => c?.compound)).toEqual([
      "Medium",
      "Soft",
      "Medium",
      "Medium",
    ]);
    for (const c of [t.fl, t.fr, t.rl, t.rr]) delete c.compound;
    t.rearCompound = "Hard";
    const byAxle = tyresView(tyresFrame(t))?.corners;
    expect([byAxle?.fl, byAxle?.fr, byAxle?.rl, byAxle?.rr].map((c) => c?.compound)).toEqual([
      "Medium",
      "Medium",
      "Hard",
      "Hard",
    ]);
  });

  it("drops non-finite numbers", () => {
    const t = designTyres();
    t.rr = tyreCorner(0.1, [Number.NaN, 90, 88], Number.POSITIVE_INFINITY, Number.NaN);
    const v = tyresView(tyresFrame(t));
    expect(v?.corners.rr.surface.inner).toBeNull();
    expect(v?.corners.rr.pressureKpa).toBeNull();
    expect(v?.corners.rr.brakeC).toBeNull();
  });
});

describe("tempsLeftToRight", () => {
  const t = { inner: 94, middle: 91, outer: 87 };
  it("reads outer, middle, inner on the left tyres and inner, middle, outer on the right", () => {
    expect(tempsLeftToRight("fl", t)).toEqual([87, 91, 94]);
    expect(tempsLeftToRight("rl", t)).toEqual([87, 91, 94]);
    expect(tempsLeftToRight("fr", t)).toEqual([94, 91, 87]);
    expect(tempsLeftToRight("rr", t)).toEqual([94, 91, 87]);
  });

  it("gives the design's numbers for the sample", () => {
    const row = (id: "fl" | "fr" | "rl" | "rr") =>
      tempsLeftToRight(id, SAMPLE_TYRES_VIEW.corners[id].surface);
    expect(row("fl")).toEqual([87, 91, 94]);
    expect(row("fr")).toEqual([96, 93, 89]);
    expect(row("rl")).toEqual([85, 88, 90]);
    expect(row("rr")).toEqual([91, 89, 86]);
  });
});

describe("tempBand", () => {
  const band = (inner: number | null, middle: number | null, outer: number | null) =>
    tempBand({ inner, middle, outer }, WINDOW);

  it("goes by the hottest point for hot and overheating, the average for cold", () => {
    expect(band(94, 91, 87)).toBe("ok");
    expect(band(96, 93, 89)).toBe("hot");
    expect(band(95, 95, 95)).toBe("ok");
    expect(band(106, 95, 90)).toBe("overheat");
    expect(band(72, 68, 65)).toBe("cold");
    expect(band(75, 70, 66)).toBe("ok");
    expect(band(null, null, null)).toBe("unknown");
    expect(band(null, 60, null)).toBe("cold");
  });
});

describe("treadBand", () => {
  it.each([
    [1, "ok"],
    [0.6, "ok"],
    [0.59, "warn"],
    [0.35, "warn"],
    [0.34, "critical"],
    [0, "critical"],
    [null, "unknown"],
  ] as const)("%s of the tread left is %s", (tread, band) => {
    expect(treadBand(tread, 60, 35)).toBe(band);
  });
});

describe("compounds", () => {
  it.each([
    ["Soft", "soft"],
    ["Medium", "medium"],
    ["Hard", "hard"],
    ["Wet", "wet"],
    ["Rain", "wet"],
    ["Intermediate", "inter"],
    ["Hypercar Wet Inter", "inter"],
    ["Bias-ply", "other"],
    [null, "other"],
  ] as const)("%s is in the %s family", (name, family) => {
    expect(compoundFamily(name)).toBe(family);
  });

  it.each([
    ["Soft", "S"],
    ["Medium", "M"],
    ["Hard", "H"],
    ["Intermediate", "I"],
    ["Wet", "W"],
    ["Bias-ply", "?"],
  ] as const)("%s has the initial %s", (name, initial) => {
    expect(compoundInitial(name)).toBe(initial);
  });

  /** The sample with the four tyres' compounds in grid order. */
  const fitted = (fl: string | null, fr: string | null, rl: string | null, rr: string | null) => {
    const c = SAMPLE_TYRES_VIEW.corners;
    return {
      ...SAMPLE_TYRES_VIEW,
      corners: {
        fl: { ...c.fl, compound: fl },
        fr: { ...c.fr, compound: fr },
        rl: { ...c.rl, compound: rl },
        rr: { ...c.rr, compound: rr },
      },
    };
  };

  it("writes the pill: the set's compound, or MIXED in the neutral colour", () => {
    expect(compoundPill(SAMPLE_TYRES_VIEW, true)).toEqual({
      text: "MEDIUM · L15",
      family: "medium",
    });
    expect(compoundPill({ ...SAMPLE_TYRES_VIEW, lapsOnSet: null }, true)?.text).toBe("MEDIUM");
    const leftRight = fitted("Soft", "Medium", "Medium", "Medium");
    expect(compoundPill(leftRight, true)).toEqual({ text: "MIXED · L15", family: "other" });
    expect(compoundPill(leftRight, false)).toEqual({ text: "MIXED · L15", family: "other" });
    const frontRear = { ...fitted("Medium", "Medium", "Hard", "Hard"), lapsOnSet: 3 };
    expect(compoundPill(frontRear, true)).toEqual({ text: "MIXED · L3", family: "other" });
    // Without a badge on each tyre, a front/rear split is still spelled out.
    expect(compoundPill(frontRear, false)).toEqual({
      text: "MEDIUM / HARD · L3",
      family: "medium",
    });
  });

  it("leaves unknown tyres out of the pill", () => {
    expect(compoundPill(fitted(null, null, "Soft", "Soft"), true)?.text).toBe("SOFT · L15");
    expect(compoundPill(fitted(null, null, null, null), true)).toEqual({
      text: "L15",
      family: "other",
    });
    expect(compoundPill({ ...fitted(null, null, null, null), lapsOnSet: null }, true)).toBeNull();
  });
});
