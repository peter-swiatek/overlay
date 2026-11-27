import { describe, expect, it } from "vitest";
import { iracingCarType, parseTrackCategory, type CarTypeInput } from "./car-type";

const car = (carName: string, more: Partial<CarTypeInput> = {}): CarTypeInput => ({
  carName,
  className: null,
  carPath: null,
  trackCategory: "road",
  ...more,
});

describe("parseTrackCategory", () => {
  it("reads WeekendInfo Category", () => {
    expect(parseTrackCategory("Road")).toBe("road");
    expect(parseTrackCategory("Oval")).toBe("oval");
    expect(parseTrackCategory("DirtRoad")).toBe("dirtRoad");
    expect(parseTrackCategory("DirtOval")).toBe("dirtOval");
    expect(parseTrackCategory("Dirt Oval")).toBe("dirtOval");
    expect(parseTrackCategory("Moon")).toBeNull();
    expect(parseTrackCategory(null)).toBeNull();
  });
});

describe("iracingCarType", () => {
  it("calls every car on an oval Oval and on dirt Dirt", () => {
    expect(iracingCarType(car("Dallara IR18", { trackCategory: "oval" }))).toBe("oval");
    expect(
      iracingCarType(
        car("NASCAR Cup Series Next Gen Chevrolet Camaro ZL1", { trackCategory: "oval" }),
      ),
    ).toBe("oval");
    expect(iracingCarType(car("Dirt Sprint Car", { trackCategory: "dirtOval" }))).toBe("dirt");
    expect(iracingCarType(car("Pro 2 Lite Off-Road Truck", { trackCategory: "dirtRoad" }))).toBe(
      "dirt",
    );
  });

  it.each([
    "Dallara F3",
    "Formula Renault 2.0",
    "Super Formula SF23",
    "Super Formula Lights",
    "IndyCar Dallara IR-18",
    "Skip Barber Formula 2000",
    "Ray FF1600",
    "Formula Vee",
    "Mercedes-AMG W12 E Performance",
    "Mercedes-AMG W13 E Performance",
    "Williams-Toyota FW31",
    "McLaren MP4-30",
    "Lotus 79",
    "Pro Mazda",
    "USF 2000",
    "FIA F4",
    "Dallara iR-01",
  ])("calls %s Formula on a road course", (name) => {
    expect(iracingCarType(car(name))).toBe("formula");
  });

  it.each([
    "Dallara P217",
    "Porsche 911 GT3 R (992)",
    "BMW M4 GT3",
    "Cadillac V-Series.R GTP",
    "Global Mazda MX-5 Cup",
    "Toyota GR86",
    "Ferrari 296 GT3",
  ])("calls %s Sports car on a road course", (name) => {
    expect(iracingCarType(car(name))).toBe("sports");
  });

  it("also reads the class short name and the CarPath", () => {
    expect(iracingCarType(car("Mystery", { className: "FR2.0" }))).toBe("formula");
    expect(iracingCarType(car("Mystery", { carPath: "dallaraf3" }))).toBe("formula");
    expect(iracingCarType(car("Mystery", { carPath: "porsche992rgt3" }))).toBe("sports");
  });

  it("decides by the car alone when the track category is unknown", () => {
    expect(iracingCarType(car("Dallara F3", { trackCategory: null }))).toBe("formula");
    expect(iracingCarType(car("BMW M4 GT3", { trackCategory: null }))).toBe("sports");
  });
});
