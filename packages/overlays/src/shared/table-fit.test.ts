import { NOMINAL_TABLE_METRICS } from "@overlay/ui/fit";
import { DEFAULT_DISPLAY_PREFS } from "@overlay/ui/types";
import { describe, expect, it } from "vitest";
import type { OverlayManifest } from "../contract";
import { applySettingsPatch, defaultInstanceSettings } from "../settings";
import { driverColumns } from "./columns";
import { DRIVER_FIELD_IDS, driverFields } from "./fields";
import { TABLE_OPTION_FIELDS } from "./options";
import { IRATING_CHARS } from "./fields";
import { fitColumnsFor, iRatingSizeFor, tableWidthsFor } from "./table-fit";

const BOARD = [
  "position",
  "car-number",
  "driver",
  "licence",
  "irating",
  "gap",
  "interval",
  "last-lap",
] as const;

const MANIFEST: OverlayManifest = {
  id: "fit-test",
  title: "Fit test",
  description: "",
  sims: ["iracing"],
  defaultSize: { width: 600, height: 400 },
  minSize: { width: 300, height: 160 },
  defaultPosition: { x: 0, y: 0 },
  table: true,
  fields: driverFields(DRIVER_FIELD_IDS, [...BOARD]),
  settings: TABLE_OPTION_FIELDS,
  rateHz: 10,
  defaultEnabled: true,
};

describe("fitColumnsFor", () => {
  it("matches the columns the overlay gives DataTable", () => {
    const columns = driverColumns({
      prefs: DEFAULT_DISPLAY_PREFS,
      nameDisplay: "driver",
      nameFormat: "f-last",
      gapDecimals: 1,
      lapDecimals: 3,
      combinedLicencePill: false,
      gapMode: "standings",
    });
    const expected = columns.map((c) => ({
      id: c.id,
      chars: c.chars,
      minChars: c.minChars,
      grow: c.grow,
      dropPriority: c.dropPriority,
    }));
    expect(fitColumnsFor(MANIFEST)).toEqual(expected);
  });
});

describe("tableWidthsFor", () => {
  it("fits the board columns between 560 and 640 px at the nominal font", () => {
    const widths = tableWidthsFor(
      MANIFEST,
      defaultInstanceSettings(MANIFEST),
      NOMINAL_TABLE_METRICS,
    );
    expect(widths?.fitPx).toBeGreaterThanOrEqual(560);
    expect(widths?.fitPx).toBeLessThanOrEqual(640);
    expect(widths?.minPx).toBeLessThan(widths?.floorPx ?? 0);
  });

  it("has no fit in custom mode", () => {
    const settings = applySettingsPatch(MANIFEST, defaultInstanceSettings(MANIFEST), {
      options: { "column-width": "custom" },
    });
    const widths = tableWidthsFor(MANIFEST, settings, NOMINAL_TABLE_METRICS);
    expect(widths?.fitPx).toBeNull();
    expect(widths?.floorPx).toBeGreaterThan(0);
  });

  it("is null for a non-table manifest", () => {
    const manifest = { ...MANIFEST, table: false };
    expect(
      tableWidthsFor(manifest, defaultInstanceSettings(manifest), NOMINAL_TABLE_METRICS),
    ).toBeNull();
  });
});

describe("iRating pill size in the fit", () => {
  const WITH_TOGGLE: OverlayManifest = {
    ...MANIFEST,
    settings: [
      ...MANIFEST.settings,
      {
        key: "irating-change",
        label: "iRating change",
        kind: "toggle",
        section: "Drivers",
        default: false,
      },
    ],
  };
  const withToggle = (on: boolean) =>
    applySettingsPatch(WITH_TOGGLE, defaultInstanceSettings(WITH_TOGGLE), {
      options: { "irating-change": on },
    });
  const ir = (columns: ReturnType<typeof fitColumnsFor>) => columns.find((c) => c.id === "irating");

  it("is auto without the toggle and narrow or wide with it", () => {
    expect(iRatingSizeFor(MANIFEST)).toBe("auto");
    expect(iRatingSizeFor(WITH_TOGGLE)).toBe("narrow");
    expect(iRatingSizeFor(WITH_TOGGLE, withToggle(true))).toBe("wide");
    expect(iRatingSizeFor(WITH_TOGGLE, withToggle(false))).toBe("narrow");
  });

  it("sets the irating chars and floor per size", () => {
    expect(ir(fitColumnsFor(MANIFEST))).toMatchObject({ chars: IRATING_CHARS.auto });
    expect(ir(fitColumnsFor(WITH_TOGGLE, withToggle(false)))).toMatchObject({
      chars: IRATING_CHARS.narrow,
      minChars: IRATING_CHARS.narrow,
    });
    expect(ir(fitColumnsFor(WITH_TOGGLE, withToggle(true)))).toMatchObject({
      chars: IRATING_CHARS.wide,
      minChars: IRATING_CHARS.wide,
    });
  });

  it("matches the columns the overlay gives DataTable for each size", () => {
    for (const on of [false, true]) {
      const columns = driverColumns({
        prefs: DEFAULT_DISPLAY_PREFS,
        nameDisplay: "driver",
        nameFormat: "f-last",
        gapDecimals: 1,
        lapDecimals: 3,
        combinedLicencePill: false,
        gapMode: "standings",
        iRatingSize: on ? "wide" : "narrow",
      });
      const expected = columns.find((c) => c.id === "irating");
      const got = ir(fitColumnsFor(WITH_TOGGLE, withToggle(on)));
      expect(got).toMatchObject({ chars: expected?.chars, minChars: expected?.minChars });
    }
  });

  it("widens the table fit with the wide pill", () => {
    const fit = (on: boolean) =>
      tableWidthsFor(WITH_TOGGLE, withToggle(on), NOMINAL_TABLE_METRICS)?.fitPx ?? 0;
    expect(fit(true)).toBeGreaterThan(fit(false));
  });
});
