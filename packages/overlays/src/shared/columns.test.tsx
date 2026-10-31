import { DEFAULT_DISPLAY_PREFS, type NameDisplay, type NameFormat } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { driverColumns, driverRowStyle, type DriverColumnContext } from "./columns";
import { DRIVER_FIELD_IDS, DRIVER_FIELDS, driverFields } from "./fields";
import { FIXTURE_NAMES, fixtureFrame } from "./fixtures";
import { driverRows, type DriverRow } from "./rows";

const CTX: DriverColumnContext = {
  prefs: DEFAULT_DISPLAY_PREFS,
  nameDisplay: "driver",
  nameFormat: "full",
  gapDecimals: 1,
  lapDecimals: 3,
  combinedLicencePill: false,
  gapMode: "standings",
};

function row(extra: Partial<DriverRow> = {}): DriverRow {
  const base = driverRows(fixtureFrame({ cars: [{ carIdx: 0 }] }), {
    livePositions: true,
    gapDecimals: 1,
    lapDecimals: 3,
  })[0];
  if (base === undefined) throw new Error("no row");
  return { ...base, ...extra };
}

function cell(id: string, r: DriverRow, ctx: Partial<DriverColumnContext> = {}): string {
  const col = driverColumns({ ...CTX, ...ctx }).find((c) => c.id === id);
  if (col === undefined) throw new Error(`no column ${id}`);
  return renderToStaticMarkup(<>{col.render(r)}</>);
}

describe("driverColumns", () => {
  it("has one column per field id, in order, with the reference labels", () => {
    const cols = driverColumns(CTX);
    expect(cols.map((c) => c.id)).toEqual([...DRIVER_FIELD_IDS]);
    expect(cols.map((c) => c.label)).toEqual(DRIVER_FIELDS.map((f) => f.label));
    expect(cols.find((c) => c.id === "driver")?.grow).toBe(true);
  });

  it("shows -- for every unknown value", () => {
    const r = row();
    for (const id of [
      "position",
      "overall-position",
      "car-number",
      "car-class",
      "driver",
      "gap",
      "interval",
      "last-lap",
      "best-lap",
      "avg-lap",
      "last-lap-delta",
      "best-lap-delta",
      "lap",
      "last-pitted",
      "stint-lap",
      "prev-stint",
      "energy",
    ]) {
      expect(cell(id, r)).toContain("--");
    }
    expect(cell("licence", r)).toContain("--");
    expect(cell("irating", r)).toContain("--");
  });

  it("formats names in all formats and displays", () => {
    const formats: NameFormat[] = ["full", "f-last", "first-l", "last", "first", "last-f"];
    const displays: NameDisplay[] = ["driver", "team", "driver-team"];
    for (const name of FIXTURE_NAMES.slice(0, 3)) {
      for (const nameFormat of formats) {
        for (const nameDisplay of displays) {
          const html = cell("driver", row({ driverName: name, teamName: "Team Fiction" }), {
            nameFormat,
            nameDisplay,
          });
          expect(html.length).toBeGreaterThan(0);
          expect(html).not.toBe("--");
        }
      }
    }
    expect(cell("driver", row({ driverName: "José María Pérez" }))).toBe("José María Pérez");
    expect(cell("driver", row({ driverName: "Zofia Świątkowska" }), { nameFormat: "f-last" })).toBe(
      "Z. Świątkowska",
    );
    expect(
      cell("driver", row({ driverName: "Max Example", teamName: "Team Fiction" }), {
        nameDisplay: "driver-team",
      }),
    ).toContain("Team Fiction");
  });

  it("uses formatDelta for relative gaps and formatGap for standings", () => {
    const rel = { gapMode: "relative" as const };
    expect(cell("gap", row({ relativeGapS: 1.2 }), rel)).toBe("+1.2");
    expect(cell("gap", row({ relativeGapS: -0.8 }), rel)).toBe("-0.8");
    expect(cell("gap", row({ relativeGapS: 0 }), rel)).toBe("0.0");
    expect(cell("gap", row({ gapToClassLeader: { laps: 1, seconds: 3 } }))).toBe("+1 L");
    expect(cell("interval", row({ interval: { laps: 0, seconds: 3.4 } }))).toBe("+3.4");
  });

  it("paints fastest laps purple", () => {
    expect(cell("best-lap", row({ bestLapS: 89.5, fastest: true }))).toContain(
      "var(--ov-locked-fastest)",
    );
    expect(cell("best-lap", row({ bestLapS: 89.5, fastest: false }))).not.toContain("fastest");
    expect(cell("best-lap", row({ bestLapS: 89.5 }))).toContain("1:29.500");
  });

  it("colours deltas by the rounded sign", () => {
    expect(cell("last-lap-delta", row({ lastLapDeltaS: -0.4 }))).toContain("--ov-locked-gain");
    expect(cell("last-lap-delta", row({ lastLapDeltaS: 0.4 }))).toContain("--ov-locked-loss");
    const zero = cell("best-lap-delta", row({ bestLapDeltaS: 0 }));
    expect(zero).toContain("--ov-text-muted");
    expect(zero).toContain("0.0");
  });

  it("puts the class colour on the car number through the row style", () => {
    const r = row({ carNumber: "12", classColour: "#ffda59" });
    expect(driverRowStyle(r)).toEqual({ "--ov-class-colour": "#ffda59" });
    expect(driverRowStyle(row())).toBeUndefined();
    const html = cell("car-number", r);
    expect(html).toContain("var(--ov-class-colour, var(--ov-header))");
    expect(html).toContain("#12");
    expect(cell("car-number", row({ carNumber: "7" }))).toContain("var(--ov-text)");
  });

  it("tints the iRating pill only with the combined licence pill", () => {
    const r = row({ iRating: 2400, licence: "A 3.41" });
    expect(cell("irating", r)).toContain("ov-pill--plain");
    const tinted = cell("irating", r, { combinedLicencePill: true });
    expect(tinted).not.toContain("ov-pill--plain");
    expect(tinted).toContain("2.4k");
  });

  it("shows pit and stint indicators", () => {
    expect(cell("pit-lane", row({ onPitRoad: true }))).toBe("PIT");
    expect(cell("pit-lane", row())).toBe("");
    expect(cell("pit-stall", row({ inPitStall: true }))).toBe("STALL");
    expect(cell("last-pitted", row({ lastPitLap: 12 }))).toBe("L12");
    expect(cell("energy", row({ energyFraction: 0.42 }))).toBe("42%");
  });
});

describe("driverFields", () => {
  it("returns a subset in order with the given visibility", () => {
    const fields = driverFields(["gap", "position", "driver"], ["position"]);
    expect(fields.map((f) => f.id)).toEqual(["gap", "position", "driver"]);
    expect(fields.map((f) => f.defaultVisible)).toEqual([false, true, false]);
  });

  it("throws on an unknown id", () => {
    expect(() => driverFields(["nope" as never], [])).toThrow();
  });

  it("marks sim-specific columns", () => {
    expect(DRIVER_FIELDS.find((f) => f.id === "energy")?.sims).toEqual(["lmu"]);
    expect(DRIVER_FIELDS.find((f) => f.id === "irating")?.sims).toEqual(["iracing"]);
  });
});
