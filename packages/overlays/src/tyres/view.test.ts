import { describe, expect, it } from "vitest";
import { designTyres, tyreCorner, tyresFrame } from "./testing";
import {
  compoundFamily,
  compoundText,
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
    expect(v?.frontCompound).toBe("Medium");
    expect(v?.rearCompound).toBe("Medium");
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
    delete t.fl.innerLayerTemps;
    delete t.fl.brakeTempC;
    t.fl.wear = null;
    const f = tyresFrame(t);
    // An older frame has no tyre stint either.
    delete (f.derived as { tyreStint?: unknown }).tyreStint;
    const v = tyresView(f);
    expect(v?.frontCompound).toBeNull();
    expect(v?.lapsOnSet).toBeNull();
    expect(v?.corners.fl.innerLayer).toBeNull();
    expect(v?.corners.fl.brakeC).toBeNull();
    expect(v?.corners.fl.tread).toBeNull();
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

  it("writes the pill text", () => {
    const base = { ...SAMPLE_TYRES_VIEW };
    expect(compoundText(base)).toBe("MEDIUM · L15");
    expect(compoundText({ ...base, lapsOnSet: null })).toBe("MEDIUM");
    expect(compoundText({ ...base, rearCompound: "Hard", lapsOnSet: 3 })).toBe(
      "MEDIUM / HARD · L3",
    );
    expect(compoundText({ ...base, frontCompound: null })).toBe("MEDIUM · L15");
    expect(compoundText({ ...base, frontCompound: null, rearCompound: null })).toBe("L15");
    expect(
      compoundText({ ...base, frontCompound: null, rearCompound: null, lapsOnSet: null }),
    ).toBeNull();
  });
});
