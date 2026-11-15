import { describe, expect, it } from "vitest";
import { CAR_MAKES, iracingCarMake, lmuCarMake } from "./car-make";

describe("CAR_MAKES", () => {
  it("keys every make by its own id: lower case, words joined by -", () => {
    for (const [key, make] of Object.entries(CAR_MAKES)) {
      expect(make.id).toBe(key);
      expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(make.code).toMatch(/^[A-Z]{2,3}$/);
      expect(make.name.length).toBeGreaterThan(0);
    }
    expect(CAR_MAKES["aston-martin"]?.name).toBe("Aston Martin");
    expect(CAR_MAKES["isotta-fraschini"]?.code).toBe("ISO");
    expect(CAR_MAKES["glickenhaus"]?.code).toBe("SCG");
  });
});

describe("iracingCarMake", () => {
  it("reads the car paths iRacing writes", () => {
    const cases: [string, string][] = [
      ["ferrari296gt3", "ferrari"],
      ["mercedesamgevogt3", "mercedes"],
      ["porsche992rgt3", "porsche"],
      ["chevyvettez06rgt3", "chevrolet"],
      ["fordmustanggt3", "ford"],
      ["c8rvettegte", "chevrolet"],
      ["amvantagegt4", "aston-martin"],
      ["hpdarx01c", "honda"],
      ["bmwm4gt3", "bmw"],
      ["mclaren720sgt3", "mclaren"],
      ["lamborghinievogt3", "lamborghini"],
      ["audir8lmsevo2gt3", "audi"],
      ["acuransxevo22gt3", "acura"],
      ["toyotagr86", "toyota"],
      ["cadillacvseriesrgtp", "cadillac"],
      ["dallarap217", "dallara"],
      ["ligierjsp320", "ligier"],
      ["rileydp", "riley"],
      ["superformulasf23", "dallara"],
      ["vwbeetlegrc", "volkswagen"],
      ["ktmxbowgtx", "ktm"],
      ["safety pcporsche911cup", "porsche"],
    ];
    for (const [path, make] of cases)
      expect([path, iracingCarMake(path, null)]).toEqual([path, make]);
  });

  it("falls back to the screen name, then to null", () => {
    expect(iracingCarMake("unknowncar", "Ferrari 296 GT3")).toBe("ferrari");
    expect(iracingCarMake(null, "Mercedes-AMG GT3 2020")).toBe("mercedes");
    expect(iracingCarMake("skippy", "Skip Barber Formula 2000")).toBeNull();
    expect(iracingCarMake(null, null)).toBeNull();
    expect(iracingCarMake("", "")).toBeNull();
  });

  it("only returns makes that CAR_MAKES knows", () => {
    for (const path of ["ferrari296gt3", "rileydp", "isottafraschinitipo6", "scg007"]) {
      const make = iracingCarMake(path, null);
      expect(make).not.toBeNull();
      expect(CAR_MAKES[make!]).toBeDefined();
    }
  });
});

describe("lmuCarMake", () => {
  it("makes every LMP2 an Oreca", () => {
    expect(lmuCarMake("Some Team 2026 #83:LM", "LMP2")).toBe("oreca");
    expect(lmuCarMake(null, "LMP2")).toBe("oreca");
  });

  it("prefers a make named in the vehicle name", () => {
    expect(lmuCarMake("Toyota Racing 2026 #7:LM", "Hyper")).toBe("toyota");
    expect(lmuCarMake("Peugeot TotalEnergies 2026 #93:LM", "Hyper")).toBe("peugeot");
    expect(lmuCarMake("Isotta Fraschini 2024 #11:LM", "Hyper")).toBe("isotta-fraschini");
    expect(lmuCarMake("Alpine Endurance Team 2026 #36:LM", "Hyper")).toBe("alpine");
    expect(lmuCarMake("Glickenhaus Racing 2023 #708:LM", "Hyper")).toBe("glickenhaus");
    expect(lmuCarMake("Duqueine Team 2023 #30:LM", "LMP3")).toBe("duqueine");
  });

  it("knows the teams of a class whose names leave out the make", () => {
    expect(lmuCarMake("AF Corse 2026 #83:LM", "Hyper")).toBe("ferrari");
    expect(lmuCarMake("Porsche Penske Motorsport 2026 #6:LM", "Hyper")).toBe("porsche");
    expect(lmuCarMake("Hertz Team JOTA 2026 #12:LM", "Hyper")).toBe("cadillac");
    expect(lmuCarMake("Manthey EMA 2026 #91:LM", "LMGT3")).toBe("porsche");
    expect(lmuCarMake("Iron Dames 2026 #85:LM", "LMGT3")).toBe("lamborghini");
    // A team's make depends on the class: Proton runs Porsche in Hyper and Ford in LMGT3.
    expect(lmuCarMake("Proton Competition 2026 #99:LM", "Hyper")).toBe("porsche");
    expect(lmuCarMake("Proton Competition 2026 #88:LM", "LMGT3")).toBe("ford");
  });

  it("does not read a car number as part of the name, and is null when unknown", () => {
    expect(lmuCarMake("Some Team 2026 #83:LM", "Hyper")).toBeNull();
    expect(lmuCarMake("Example Racing Team 2026 #83:LM", "LMGT3")).toBeNull();
    expect(lmuCarMake(null, null)).toBeNull();
  });
});
