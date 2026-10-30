import { describe, expect, it } from "vitest";
import { FIXTURE_DIR, loadSlice } from "./slice-support";
import { performance } from "node:perf_hooks";
import { IracingDecoder, VarType, decodeSessionYaml } from "./decoder";
import { syntheticLayout } from "./synthetic";
import { SessionInfoCache, mapSessionType, parseSessionYaml } from "./session-yaml";

function yamlWithDrivers(driverLines: string[], extra = ""): string {
  return [
    "---",
    "WeekendInfo:",
    " TrackDisplayName: Test Ring",
    " TrackLength: 3.20 km",
    " TrackPitSpeedLimit: 37.28 mph",
    "SessionInfo:",
    " CurrentSessionNum: 0",
    " Sessions:",
    " - SessionNum: 0",
    "   SessionLaps: 12",
    "   SessionTime: unlimited",
    "   SessionType: Race",
    "DriverInfo:",
    " DriverCarIdx: 1",
    " DriverCarFuelMaxLtr: 100.000",
    " DriverCarMaxFuelPct: 0.750",
    " Drivers:",
    ...driverLines,
    extra,
    "",
  ].join("\n");
}

function driver(carIdx: number, fields: Record<string, string>): string[] {
  return [` - CarIdx: ${carIdx}`, ...Object.entries(fields).map(([k, v]) => `   ${k}: ${v}`)];
}

describe("parseSessionYaml on the committed slices", () => {
  it("extracts weekend, session and driver info", async () => {
    const slice = await loadSlice(`${FIXTURE_DIR}iracing-ferrari-race-start-20s.ovfx`);
    const info = parseSessionYaml(slice.yamlTexts[0] ?? "");
    expect(info.trackName).toBe("Virginia International Raceway");
    expect(info.trackLengthM).toBeCloseTo(5216.9, 3);
    expect(info.pitSpeedLimitMps).toBeCloseTo(60 / 3.6, 6);
    expect(info.currentSessionNum).toBe(2);
    expect(info.sessions.map((s) => [s.sessionNum, s.type, s.lapsLimit, s.timeLimitS])).toEqual([
      [0, "practice", null, 180],
      [1, "qualifying", 2, 480],
      [2, "race", null, 1200],
    ]);
    expect(info.driverCarIdx).toBe(14);
    expect(info.fuelCapacityL).toBe(52); // 104 L x 0.5
    expect(info.drivers.map((d) => d.carIdx)).toEqual([...Array(15).keys(), 64]);
    expect(info.drivers.filter((d) => d.isPaceCar).map((d) => d.carIdx)).toEqual([64]);
    const player = info.drivers.find((d) => d.carIdx === 14);
    expect(player).toMatchObject({
      driverName: "Driver 14",
      carName: "Chevrolet Corvette Z06 GT3.R",
      carNumber: "15",
      classId: "2708",
      className: "GT3 Class",
      classColour: "#ffffff",
      iRating: 1479,
      license: "B 2.82",
      isPaceCar: false,
    });
  });

  it("sees the current session change when the YAML is re-sent at a session switch", async () => {
    const slice = await loadSlice(`${FIXTURE_DIR}iracing-ferrari-quali-to-race-10s.ovfx`);
    const nums = slice.yamlTexts.map((t) => parseSessionYaml(t).currentSessionNum);
    expect(nums).toEqual([1, 2, 2]);
  });
});

describe("parseSessionYaml quirks (synthetic)", () => {
  it("keeps names with colons, hashes, quotes and indicator characters", () => {
    const text = yamlWithDrivers([
      ...driver(1, { UserName: "Bob: the Builder", CarNumber: '"7"', IRating: "1500" }),
      ...driver(2, { UserName: "#1 Racing", CarNumber: "8" }),
      ...driver(3, { UserName: "*Star* & Co", CarNumber: "9" }),
      ...driver(4, { UserName: '"Quoted" Name', CarNumber: "10" }),
      ...driver(5, { UserName: "null", CarNumber: "11" }),
      ...driver(6, { UserName: "yes", CarNumber: "12" }),
      ...driver(7, { UserName: "- dash [x] {y} | z > w", CarNumber: "13" }),
      ...driver(8, { UserName: "José Müller", CarNumber: "14" }),
      ...driver(9, { UserName: "tab\tinside", CarNumber: "15" }),
    ]);
    const names = new Map(parseSessionYaml(text).drivers.map((d) => [d.carIdx, d.driverName]));
    expect(names.get(1)).toBe("Bob: the Builder");
    expect(names.get(2)).toBe("#1 Racing");
    expect(names.get(3)).toBe("*Star* & Co");
    expect(names.get(4)).toBe('"Quoted" Name');
    expect(names.get(5)).toBe("null");
    expect(names.get(6)).toBe("yes");
    expect(names.get(7)).toBe("- dash [x] {y} | z > w");
    expect(names.get(8)).toBe("José Müller");
    expect(names.get(9)).toBe("tab\tinside");
    const one = parseSessionYaml(text).drivers.find((d) => d.carIdx === 1);
    expect(one?.carNumber).toBe("7");
    expect(one?.iRating).toBe(1500);
  });

  it("treats empty values as null and survives Windows line endings and NULs", () => {
    const text = yamlWithDrivers([
      ...driver(1, { UserName: "A", CarClassShortName: "", CarClassColor: "0x00ff0a" }),
    ])
      .replace(/\n/g, "\r\n")
      .concat("\0\0\0");
    const d = parseSessionYaml(text).drivers[0];
    expect(d?.className).toBeNull();
    expect(d?.classColour).toBe("#00ff0a");
  });

  it("pads short colours and rejects garbage", () => {
    const text = yamlWithDrivers([
      ...driver(1, { CarClassColor: "0xff" }),
      ...driver(2, { CarClassColor: "red" }),
    ]);
    const [a, b] = parseSessionYaml(text).drivers;
    expect(a?.classColour).toBe("#0000ff");
    expect(b?.classColour).toBeNull();
  });

  it("converts units for length and pit speed, and handles unlimited laps and time", () => {
    const info = parseSessionYaml(yamlWithDrivers([]));
    expect(info.trackLengthM).toBeCloseTo(3200, 6);
    expect(info.pitSpeedLimitMps).toBeCloseTo(37.28 * 0.44704, 6);
    expect(info.sessions[0]).toMatchObject({ lapsLimit: 12, timeLimitS: null, type: "race" });
    expect(info.fuelCapacityL).toBe(75);
    const miles = parseSessionYaml("WeekendInfo:\n TrackLength: 3.2 mi\n TrackName: raw name\n");
    expect(miles.trackLengthM).toBeCloseTo(3.2 * 1609.344, 6);
    expect(miles.trackName).toBe("raw name"); // falls back when there is no display name
    expect(parseSessionYaml(" TrackLength: 3.2 mi\n").trackLengthM).toBeNull(); // no section
  });

  it("leaves out spectators but keeps the pace car, flagged", () => {
    const text = yamlWithDrivers([
      ...driver(1, { UserName: "Racer", IsSpectator: "0", CarIsPaceCar: "0" }),
      ...driver(2, { UserName: "Watcher", IsSpectator: "1", CarIsPaceCar: "0" }),
      ...driver(64, { UserName: "Pace", IsSpectator: "0", CarIsPaceCar: "1" }),
    ]);
    const drivers = parseSessionYaml(text).drivers;
    expect(drivers.map((d) => [d.carIdx, d.isPaceCar])).toEqual([
      [1, false],
      [64, true],
    ]);
  });

  it("returns nulls and empty lists for an empty or broken document", () => {
    for (const text of ["", "garbage", "WeekendInfo:\n \t\x01: [\n  - : :\n"]) {
      const info = parseSessionYaml(text);
      expect(info.trackName).toBeNull();
      expect(info.drivers).toEqual([]);
      expect(info.sessions).toEqual([]);
      expect(info.fuelCapacityL).toBeNull();
    }
  });

  it("is not derailed by a broken section it does not use", () => {
    const text = yamlWithDrivers(
      [...driver(1, { UserName: "A" })],
      "CarSetup:\n Weird: [unclosed\n  - : :",
    );
    const info = parseSessionYaml(text);
    expect(info.drivers).toHaveLength(1);
    expect(info.trackName).toBe("Test Ring");
  });

  it("ignores YAML aliases and anchors rather than expanding them", () => {
    const text = yamlWithDrivers([...driver(1, { UserName: "&a Boo", CarNumber: "*a" })]);
    const d = parseSessionYaml(text).drivers[0];
    expect(d?.driverName).toBe("&a Boo");
    expect(d?.carNumber).toBe("*a");
  });
});

describe("mapSessionType", () => {
  it.each([
    ["Practice", "practice"],
    ["Open Qualify", "qualifying"],
    ["Lone Qualify", "qualifying"],
    ["Race", "race"],
    ["Warmup", "warmup"],
    ["Offline Testing", "practice"],
    ["Something New", "other"],
  ] as const)("%s -> %s", (name, expected) => {
    expect(mapSessionType(name)).toBe(expected);
  });
});

describe("SessionInfoCache driven by the real header counter", () => {
  const layout = syntheticLayout([{ name: "SessionTime", type: VarType.Double }]);
  const decoder = IracingDecoder.fromHeaderBytes(layout.header);

  /** A live-style header: irsdk header, then the YAML area, then the var table. */
  function liveHeader(counter: number, yaml: string): Buffer {
    const area = Buffer.alloc(4096);
    area.write(yaml, 0, "latin1");
    const h = Buffer.concat([layout.header.subarray(0, 112), area, layout.header.subarray(112)]);
    h.writeInt32LE(counter, 12);
    h.writeInt32LE(4096, 16);
    h.writeInt32LE(112, 20);
    h.writeInt32LE(112 + 4096, 28);
    return h;
  }

  it("decodes and parses the text only when the counter changes", () => {
    const live = IracingDecoder.fromHeaderBytes(liveHeader(1, yamlWithDrivers([])));
    const cache = new SessionInfoCache();
    let reads = 0;
    const tick = (header: Buffer) => {
      const counter = live.readSessionInfoUpdate(header) ?? -1;
      return cache.update(counter, () => {
        reads++;
        return live.sessionInfoText(header);
      });
    };
    const h1 = liveHeader(1, yamlWithDrivers([]));
    const first = tick(h1);
    expect(first?.trackName).toBe("Test Ring");
    for (let i = 0; i < 100; i++) expect(tick(h1)).toBe(first);
    expect(reads).toBe(1);
    // Same counter but different text in memory: not looked at.
    expect(tick(liveHeader(1, yamlWithDrivers([]).replace("Test Ring", "Nope")))).toBe(first);
    expect(reads).toBe(1);
    const h2 = liveHeader(2, yamlWithDrivers([]).replace("Test Ring", "Other"));
    const second = tick(h2);
    expect(second?.trackName).toBe("Other");
    expect(reads).toBe(2);
    expect(tick(h2)).toBe(second);
    expect(reads).toBe(2);
  });

  it("reads the counter from the header bytes", () => {
    expect(decoder.readSessionInfoUpdate(liveHeader(41, ""))).toBe(41);
    expect(decoder.readSessionInfoUpdate(new Uint8Array(4))).toBeNull();
  });

  it("keeps the previous info while the text is unavailable and retries", () => {
    const cache = new SessionInfoCache();
    expect(cache.update(0, () => null)).toBeNull();
    const a = cache.update(1, () => yamlWithDrivers([]));
    expect(a).not.toBeNull();
    expect(cache.update(2, () => null)).toBe(a);
    const b = cache.update(2, () => yamlWithDrivers([]).replace("Test Ring", "Later"));
    expect(b?.trackName).toBe("Later");
  });

  it("parses the fixture YAML in well under a second (timing is logged)", async () => {
    const slice = await loadSlice(`${FIXTURE_DIR}iracing-ferrari-sf-crossing-20s.ovfx`);
    const text = slice.yamlTexts[0] ?? "";
    parseSessionYaml(text); // warm up
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i++) parseSessionYaml(text);
    const ms = (performance.now() - start) / runs;
    console.log(`parseSessionYaml: ${ms.toFixed(2)} ms for ${text.length} chars`);
    expect(ms).toBeLessThan(1000);
  });
});

describe("Windows-1252 decoding", () => {
  it("keeps Š, ž and Œ in names", () => {
    const text = yamlWithDrivers([...driver(1, { UserName: "\u0160ar\u017eo \u0152uvre" })]);
    const bytes = Buffer.from(
      text.replace("\u0160", "\x8a").replace("\u017e", "\x9e").replace("\u0152", "\x8c"),
      "latin1",
    );
    expect(bytes.includes(0x8a)).toBe(true);
    const decoded = decodeSessionYaml(Buffer.concat([bytes, Buffer.alloc(8)]));
    expect(parseSessionYaml(decoded).drivers[0]?.driverName).toBe("\u0160ar\u017eo \u0152uvre");
  });
});
