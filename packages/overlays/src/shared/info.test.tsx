import { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from "@overlay/ui/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverlayManifest } from "../contract";
import { defaultInstanceSettings, sanitizeInstanceSettings } from "../settings";
import { flagBorderColour } from "./flags";
import { fixtureFrame } from "./fixtures";
import { HEADER_FIELD_IDS, HEADER_FIELD_OPTIONS, infoItems, type InfoContext } from "./info";
import { InfoStrip } from "./InfoStrip";
import { TABLE_OPTION_FIELDS, readTableOptions, tableOptionFields } from "./options";

const NOW = new Date(2026, 0, 1, 14, 5, 0);
const CTX: InfoContext = {
  prefs: DEFAULT_DISPLAY_PREFS,
  sessionDisplay: "auto",
  showDqLimit: true,
  now: NOW,
};

function one(id: string, frame = fixtureFrame({ cars: [] }), ctx: Partial<InfoContext> = {}) {
  return infoItems(frame, [id], { ...CTX, ...ctx })[0];
}

describe("infoItems", () => {
  const frame = fixtureFrame({
    playerCarIdx: 0,
    cars: [{ carIdx: 0, lapInProgress: 7, carNumber: "12", bestLapS: 92.3456 }],
    standingsInfo: { sof: 2412.4 },
    standings: [{ carIdx: 0, sessionBest: true }],
    session: {
      timeOfDayS: 14 * 3600 + 300,
      incidentLimit: 17,
      timing: "laps",
      lapsTotal: 30,
      lapsRemaining: 24,
      timeRemainingS: 3661,
      typeName: "Race",
    },
    conditions: {
      airTempC: 20,
      trackTempC: 30.4,
      wetness: 0.25,
      precipitation: 0.1,
      humidity: 0.5,
      fogLevel: 0,
      windDirRad: Math.PI / 2,
      windSpeedMps: 5,
    },
    player: { incidentCount: 4, brakeBias: 0.565 },
  });

  it("reads each id", () => {
    const v = (id: string) => one(id, frame)?.value;
    expect(v("sof")).toBe("2.4k");
    expect(v("incidents")).toBe("4 / 17");
    expect(v("sim-time")).toBe("14:05");
    expect(v("real-time")).toBe("14:05");
    expect(v("air-temp")).toBe("20.0 °C");
    expect(v("track-temp")).toBe("30.4 °C");
    expect(v("wetness")).toBe("25%");
    expect(v("precipitation")).toBe("10%");
    expect(v("humidity")).toBe("50%");
    expect(v("fog")).toBe("0%");
    expect(v("wind-direction")).toBe("E");
    expect(v("current-lap")).toBe("7 / 30");
    expect(v("brake-bias")).toBe("56.5%");
  });

  it("reads session type, wind and session best", () => {
    expect(one("session-type", frame)?.value).toBe("Race");
    expect(one("wind", frame)?.value).toBe("18 km/h E");
    const mph: DisplayPrefs = { units: "imperial", speedInMph: false, timeFormat: "24h" };
    expect(one("wind", frame, { prefs: mph })?.value).toBe("11 mph E");
    const noDir = fixtureFrame({ cars: [], conditions: { windSpeedMps: 5 } });
    expect(one("wind", noDir)?.value).toBe("18 km/h");
    const best = one("session-best", frame);
    expect(best).toMatchObject({ value: "1:32.346 (#12)", tone: "fastest", unavailable: false });
    expect(one("session-best", frame, { lapDecimals: 1 })?.value).toBe("1:32.3 (#12)");
    expect(one("session-type", frame)?.tone).toBeUndefined();
  });

  it("marks the new items unavailable without data", () => {
    const empty = fixtureFrame({ cars: [{ carIdx: 0 }], standings: [{ carIdx: 0 }] });
    for (const id of ["session-type", "wind", "session-best"]) {
      expect(one(id, empty)).toMatchObject({ value: "--", unavailable: true });
      expect(one(id, empty)?.tone).toBeUndefined();
    }
  });

  it("lists wind as iRacing only", () => {
    expect(HEADER_FIELD_OPTIONS.find((o) => o.value === "wind")?.sims).toEqual(["iracing"]);
    expect(HEADER_FIELD_OPTIONS.find((o) => o.value === "session-best")?.sims).toBeUndefined();
  });

  it("hides the DQ limit on request", () => {
    expect(one("incidents", frame, { showDqLimit: false })?.value).toBe("4");
  });

  it("follows the session display", () => {
    expect(one("session-remaining", frame)?.value).toBe("24 laps");
    expect(one("session-remaining", frame, { sessionDisplay: "time" })?.value).toBe("1:01:01");
    const timed = fixtureFrame({
      cars: [],
      session: { timing: "time", timeRemainingS: 725, lapsRemaining: 9 },
    });
    expect(one("session-remaining", timed)?.value).toBe("12:05");
    expect(one("session-remaining", timed, { sessionDisplay: "laps" })?.value).toBe("9 laps");
    const onlyLaps = fixtureFrame({ cars: [], session: { timing: "time", lapsRemaining: 3 } });
    expect(one("session-remaining", onlyLaps)?.value).toBe("3 laps");
  });

  it("honours 12 h and imperial prefs", () => {
    const prefs: DisplayPrefs = { units: "imperial", speedInMph: false, timeFormat: "12h" };
    expect(one("real-time", frame, { prefs })?.value).toBe("2:05 PM");
    expect(one("air-temp", frame, { prefs })?.value).toBe("68.0 °F");
  });

  it("marks missing values unavailable and skips unknown ids", () => {
    const empty = fixtureFrame({ cars: [] });
    const items = infoItems(empty, ["sof", "bogus", "wind-direction", "current-lap"], CTX);
    expect(items.map((i) => i.id)).toEqual(["sof", "wind-direction", "current-lap"]);
    for (const i of items) expect(i).toMatchObject({ value: "--", unavailable: true });
    expect(infoItems(null, ["sim-time"], CTX)[0]?.unavailable).toBe(true);
  });

  it("lists every header id as an option with sims where only iRacing reports it", () => {
    expect(HEADER_FIELD_OPTIONS.map((o) => o.value)).toEqual([...HEADER_FIELD_IDS]);
    expect(HEADER_FIELD_OPTIONS.find((o) => o.value === "sof")?.sims).toEqual(["iracing"]);
    expect(HEADER_FIELD_OPTIONS.find((o) => o.value === "sim-time")?.sims).toBeUndefined();
  });
});

describe("InfoStrip", () => {
  it("renders pairs, mutes unavailable ones, and nothing for no items", () => {
    expect(InfoStrip({ items: [] })).toBeNull();
    const html = renderToStaticMarkup(
      <InfoStrip
        items={[
          { id: "sof", label: "SoF", value: "2.4k", unavailable: false },
          { id: "fog", label: "Fog level", value: "--", unavailable: true },
        ]}
      />,
    );
    expect(html).toContain("SoF");
    expect(html).toContain("2.4k");
    expect(html.match(/ov-info-item--unavailable/g)).toHaveLength(1);
  });
});

describe("InfoStrip layout", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => ({
    id: id as "sof",
    label: id,
    value: id.toUpperCase(),
    unavailable: false,
  }));

  it("splits into a left and a right group with leftCount", () => {
    const html = renderToStaticMarkup(<InfoStrip items={items} leftCount={3} />);
    const groups = html.split('class="ov-info-group"').slice(1);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.match(/ov-info-item/g)).toHaveLength(3);
    expect(groups[1]?.match(/ov-info-item/g)).toHaveLength(2);
  });

  it("has no groups without leftCount and adds the footer class", () => {
    expect(renderToStaticMarkup(<InfoStrip items={items} />)).not.toContain("ov-info-group");
    const footer = renderToStaticMarkup(<InfoStrip items={items} variant="footer" />);
    expect(footer).toContain("ov-info-strip--footer");
    expect(renderToStaticMarkup(<InfoStrip items={items} />)).not.toContain("--footer");
  });

  it("marks a fastest tone", () => {
    const html = renderToStaticMarkup(
      <InfoStrip items={[{ ...items[0]!, tone: "fastest" }, items[1]!]} />,
    );
    expect(html.match(/ov-fastest/g)).toHaveLength(1);
  });
});

describe("flagBorderColour", () => {
  const none = {
    green: false,
    yellow: false,
    fullCourseYellow: false,
    red: false,
    blue: false,
    white: false,
    checkered: false,
    black: false,
    disqualified: false,
    repair: false,
    furled: false,
  };
  it("follows the precedence", () => {
    expect(flagBorderColour(null)).toBeNull();
    expect(flagBorderColour(none)).toBeNull();
    expect(
      flagBorderColour({ ...none, green: true, blue: true, yellow: true, red: true }),
    ).toContain("red");
    expect(flagBorderColour({ ...none, green: true, black: true, yellow: true })).toContain(
      "black",
    );
    expect(flagBorderColour({ ...none, fullCourseYellow: true, blue: true })).toContain("yellow");
    expect(flagBorderColour({ ...none, white: true, blue: true })).toContain("blue");
    expect(flagBorderColour({ ...none, white: true, green: true })).toContain("white");
    expect(flagBorderColour({ ...none, green: true })).toContain("green");
    expect(flagBorderColour({ ...none, checkered: true, green: true })).toBeNull();
  });
});

describe("table options", () => {
  const manifest: OverlayManifest = {
    id: "test",
    title: "Test",
    description: "",
    sims: ["iracing", "lmu"],
    defaultSize: { width: 100, height: 100 },
    minSize: { width: 50, height: 50 },
    defaultPosition: { x: 0, y: 0 },
    table: true,
    fields: [],
    settings: TABLE_OPTION_FIELDS,
    rateHz: 5,
    defaultEnabled: true,
  };

  it("has the documented keys, all in section Table", () => {
    expect(TABLE_OPTION_FIELDS.map((f) => f.key)).toEqual([
      "column-width",
      "width-fine-tune",
      "gap-decimals",
      "lap-decimals",
      "name-display",
      "name-format",
      "session-display",
    ]);
    expect(TABLE_OPTION_FIELDS.every((f) => f.section === "Table")).toBe(true);
  });

  it("reads defaults back", () => {
    expect(readTableOptions(defaultInstanceSettings(manifest))).toEqual({
      widthMode: "auto",
      widthScalePct: 100,
      gapDecimals: 1,
      lapDecimals: 3,
      nameDisplay: "driver",
      nameFormat: "f-last",
      sessionDisplay: "auto",
    });
  });

  it("reads sanitised values", () => {
    const settings = sanitizeInstanceSettings(manifest, {
      options: {
        "column-width": "compact",
        "width-fine-tune": 117,
        "gap-decimals": 9,
        "lap-decimals": 0,
        "name-display": "driver-team",
        "name-format": "last-f",
        "session-display": "laps",
      },
    });
    expect(readTableOptions(settings)).toEqual({
      widthMode: "compact",
      widthScalePct: 115,
      gapDecimals: 3,
      lapDecimals: 0,
      nameDisplay: "driver-team",
      nameFormat: "last-f",
      sessionDisplay: "laps",
    });
  });

  it("reads the defaults of the keys a manifest leaves out", () => {
    const fields = tableOptionFields(["name-format", "column-width"]);
    expect(fields.map((f) => f.key)).toEqual(["column-width", "name-format"]);
    const subset = { ...manifest, settings: fields };
    const settings = sanitizeInstanceSettings(subset, {
      options: { "column-width": "compact", "name-format": "last" },
    });
    expect(readTableOptions(settings)).toEqual({
      widthMode: "compact",
      widthScalePct: 100,
      gapDecimals: 1,
      lapDecimals: 3,
      nameDisplay: "driver",
      nameFormat: "last",
      sessionDisplay: "auto",
    });
  });
});
