import { createReadStream } from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { RecordKind } from "../../fixtures/format";
import { FixtureReader } from "../../fixtures/reader";
import { isSimState, type SimState } from "../../model/sim-state";
import { IracingAdapter } from "./adapter";
import { VarType, decodeSessionYaml } from "./decoder";
import { SessionInfoCache, type IracingSessionInfo } from "./session-yaml";
import { FIXTURE_DIR, loadSlice, toStates, type LoadedSlice } from "./slice-support";
import { syntheticLayout, type SyntheticVar } from "./synthetic";

const slicePath = (name: string): string => `${FIXTURE_DIR}iracing-ferrari-${name}.ovfx`;

function car(states: SimState[], i: number, carIdx: number) {
  const c = states[i]?.cars.find((x) => x.carIdx === carIdx);
  if (c === undefined) throw new Error(`no car ${carIdx} in state ${i}`);
  return c;
}

function firstIndex(states: SimState[], test: (s: SimState) => boolean): number {
  const i = states.findIndex(test);
  if (i < 0) throw new Error("no matching tick");
  return i;
}

function timeOf(slice: LoadedSlice, i: number): number {
  return slice.ticks[i]?.timeS ?? Number.NaN;
}

describe("race-start slice (formation to racing)", async () => {
  const slice = await loadSlice(slicePath("race-start-20s"));
  const states = toStates(slice);

  it("produces a valid SimState for every tick", () => {
    expect(states).toHaveLength(1161);
    for (const s of states) expect(isSimState(s)).toBe(true);
  });

  it("reads the static session facts", () => {
    const s = states[0] as SimState;
    expect(s.source).toBe("iracing");
    expect(s.connected).toBe(true);
    expect(s.playerCarIdx).toBe(14);
    expect(s.focusCarIdx).toBe(14);
    expect(s.tickTimeS).toBeGreaterThan(0);
    expect(s.session).toMatchObject({
      type: "race",
      timing: "time",
      timeTotalS: 1200,
      lapsTotal: null,
      lapsRemaining: null,
      trackName: "Virginia International Raceway",
    });
    expect(s.session.trackLengthM).toBeCloseTo(5216.9, 3);
    expect(s.session.pitSpeedLimitMps).toBeCloseTo(16.6667, 3);
    expect(s.player.fuelCapacityL).toBe(52);
    expect(s.conditions.wetness).toBe(0); // TrackWetness 1 = dry
    expect(s.conditions.airTempC).toBeCloseTo(19.25, 1);
    expect(s.conditions.trackTempC).toBeCloseTo(26.11, 1);
  });

  it("goes from formation to racing at the green flag", () => {
    const start = firstIndex(states, (s) => s.session.phase === "racing");
    expect(states[start]?.tickTimeS).toBeCloseTo(247.67, 1); // sim clock; recording clock 812.30 s
    expect(states.slice(0, start).every((s) => s.session.phase === "formation")).toBe(true);
    expect(states.slice(start).every((s) => s.session.phase === "racing")).toBe(true);
    // The green flag is shown from just before SessionState flips and for several seconds after.
    const green = firstIndex(states, (s) => s.flags?.green === true);
    expect(green).toBeLessThanOrEqual(start);
    expect(states[0]?.flags?.green).toBe(false);
    expect(states.at(-1)?.flags?.green).toBe(true);
  });

  it("has no positions during the formation lap and a full grid after the start", () => {
    const first = states[0] as SimState;
    expect(first.cars.every((c) => c.position === null && c.classPosition === null)).toBe(true);
    const last = states.at(-1) as SimState;
    // Car 3 is not in the world (no track surface), so it has no position.
    expect(car(states, states.length - 1, 3)).toMatchObject({
      position: null,
      isOnTrack: false,
      connected: false, // no track surface: nothing says it is connected
    });
    const ranked = last.cars
      .filter((c) => c.position !== null)
      .map((c) => c.position)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(ranked).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(car(states, states.length - 1, 14)).toMatchObject({
      position: 5,
      classPosition: 5,
      isPlayer: true,
      driverName: "Driver 14",
      carNumber: "15",
    });
    expect(last.cars.filter((c) => c.isPlayer === true)).toHaveLength(1);
  });

  it("sets lap counters when the player first crosses the line", () => {
    const before = firstIndex(states, (s) => s.cars.some((c) => c.carIdx === 14));
    expect(car(states, before, 14)).toMatchObject({ lapsCompleted: null, lapInProgress: null });
    const crossed = firstIndex(
      states,
      (s) => s.cars.find((c) => c.carIdx === 14)?.lapsCompleted === 0,
    );
    expect(states[crossed]?.tickTimeS).toBeCloseTo(251.48, 1); // recording clock 816.12 s
    expect(car(states, crossed, 14).lapInProgress).toBe(1);
    expect(car(states, crossed, 14).lapDistPct).toBeLessThan(0.01);
  });

  it("maps the pace car and the time limit", () => {
    const pace = car(states, 0, 64);
    expect(pace.isPaceCar).toBe(true);
    expect(pace.connected).toBe(true);
    expect(
      states.filter((s) => s.cars.some((c) => c.isPaceCar === true && c.carIdx !== 64)),
    ).toEqual([]);
    expect(states[0]?.session.timeRemainingS).toBeNull(); // SessionTimeRemain is -1 until green
    expect(states.at(-1)?.session.timeRemainingS).toBeCloseTo(1185.8, 0);
  });

  it("maps player inputs, steering sign and the clutch", () => {
    // Raw first tick: Throttle 0.6478, SteeringWheelAngle -0.0602 rad of 8.7391 max, Clutch 1.
    const p = (states[0] as SimState).player;
    expect(p.inputs.throttle).toBeCloseTo(0.6478, 3);
    expect(p.inputs.brake).toBe(0);
    expect(p.inputs.clutch).toBe(0); // iRacing reports 1 with the pedal released
    expect(p.inputs.steer).toBeCloseTo(0.0602 / 8.7391, 4); // negative angle = right = positive
    expect(p.gear).toBe(2);
    expect(p.speedMps).toBeCloseTo(30.175, 2);
    expect(p.rpm).toBeCloseTo(6418.2, 0);
    expect(p.fuelL).toBeCloseTo(50.56, 2);
    expect(p.pitLimiter).toBe(false);
    expect(p.carLeftRight).toBe("clear");
    expect(p.incidentCount).toBe(0);
    for (const s of states) {
      expect(s.player.inputs.steer).toBeGreaterThanOrEqual(-1);
      expect(s.player.inputs.steer).toBeLessThanOrEqual(1);
      expect(s.player.inputs.throttle).toBeGreaterThanOrEqual(0);
    }
    expect(states.some((s) => s.player.carLeftRight === "right")).toBe(true);
  });

  it("burns fuel over time", () => {
    const fuel = states.map((s) => s.player.fuelL ?? 0);
    expect(fuel[0]).toBeGreaterThan(fuel.at(-1) ?? 0);
  });

  it("maps tyre temperatures (L column is outer on the left, inner on the right) and wear", () => {
    const t = (states[0] as SimState).player.tyres;
    expect(t?.fl.temps.outer).toBeCloseTo(71.887, 2); // LFtempCL
    expect(t?.fl.temps.inner).toBeCloseTo(86.151, 2); // LFtempCR
    expect(t?.fr.temps.inner).toBeCloseTo(80.668, 2); // RFtempCL
    expect(t?.fr.temps.outer).toBeCloseTo(65.008, 2); // RFtempCR
    expect(t?.fl.temps.middle).toBeCloseTo(79.825, 2);
    // LFwear L/M/R = 0.9842, 0.9736, 0.9723 tread left
    expect(t?.fl.wear).toBeCloseTo(1 - (0.984218 + 0.973599 + 0.972314) / 3, 4);
    expect(t?.fl.pressureKpa).toBeNull();
  });
});

describe("S/F crossing slice (lap increments)", async () => {
  const slice = await loadSlice(slicePath("sf-crossing-20s"));
  const states = toStates(slice);

  it("produces a valid SimState for every tick", () => {
    expect(states.length).toBeGreaterThan(1000);
    for (const s of states) expect(isSimState(s)).toBe(true);
  });

  it("is a running race with no flag shown and a time limit", () => {
    expect(states.every((s) => s.session.phase === "racing" && s.session.type === "race")).toBe(
      true,
    );
    expect(states.every((s) => s.flags !== null && !Object.values(s.flags).some(Boolean))).toBe(
      true,
    );
    expect(states[0]?.session.timeRemainingS).toBeCloseTo(650.8, 0);
    expect(states[0]?.player.incidentCount).toBe(4);
  });

  it("increments the player's lap at the line and wraps lapDistPct", () => {
    const crossed = firstIndex(states, (s) => car([s], 0, 14).lapsCompleted === 5);
    expect(timeOf(slice, crossed)).toBeGreaterThan(1369.9);
    expect(timeOf(slice, crossed)).toBeLessThan(1370.0);
    const prev = car(states, crossed - 1, 14);
    expect(prev).toMatchObject({ lapsCompleted: 4, lapInProgress: 5 });
    expect(prev.lapDistPct).toBeGreaterThan(0.999);
    const now = car(states, crossed, 14);
    expect(now).toMatchObject({ lapsCompleted: 5, lapInProgress: 6 });
    expect(now.lapDistPct).toBeLessThan(0.001);
    // The lap counter never goes backwards.
    let last = 0;
    for (let i = 0; i < states.length; i++) {
      const laps = car(states, i, 14).lapsCompleted ?? 0;
      expect(laps).toBeGreaterThanOrEqual(last);
      last = laps;
    }
  });

  it("names the sim and the layout, and reads heading and car-frame velocity", () => {
    for (const s of states) {
      expect(s.sim).toBe("iracing");
      expect(s.session.trackConfig).toBe("Full Course");
      expect(s.player.worldPos).toBeNull();
    }
    // At racing speed the forward component is the speed and the sideways one is small.
    const s = states[500] as SimState;
    const v = s.player.velocityMps;
    expect(v).not.toBeNull();
    expect(Math.hypot(v?.x ?? 0, v?.y ?? 0)).toBeCloseTo(s.player.speedMps ?? 0, 0);
    expect(v?.x).toBeGreaterThan(20);
    expect(Math.abs(v?.y ?? 99)).toBeLessThan(5);
    expect(s.player.yawRad).toBeGreaterThanOrEqual(-Math.PI);
    expect(s.player.yawRad).toBeLessThanOrEqual(2 * Math.PI);
  });

  it("publishes the last lap time about two seconds after the crossing", () => {
    const crossed = firstIndex(states, (s) => car([s], 0, 14).lapsCompleted === 5);
    expect(car(states, crossed, 14).lastLapS).toBeCloseTo(105.6988, 3); // previous lap, not yet updated
    const updated = firstIndex(states, (s) => (car([s], 0, 14).lastLapS ?? 0) > 105.9);
    expect(car(states, updated, 14).lastLapS).toBeCloseTo(105.974, 3);
    expect(car(states, updated, 14).bestLapS).toBeCloseTo(105.6988, 3);
    expect(timeOf(slice, updated) - timeOf(slice, crossed)).toBeGreaterThan(1.5);
    expect(timeOf(slice, updated) - timeOf(slice, crossed)).toBeLessThan(3);
  });

  it("reads the leader and the sim's estimated time", () => {
    expect(car(states, 0, 1)).toMatchObject({
      position: 1,
      classPosition: 1,
      lapsCompleted: 5,
      lapInProgress: 6,
      carName: "Ferrari 296 GT3",
      iRating: 2228,
      license: "B 2.89",
    });
    expect(car(states, 0, 1).lastLapS).toBeCloseTo(104.7196, 3);
    expect(car(states, 0, 1).bestLapS).toBeCloseTo(104.6561, 3);
    expect(car(states, 0, 1).estTimeS).toBeCloseTo(18.227, 2);
  });
});

describe("quali to race slice (session change and YAML re-parse)", async () => {
  const slice = await loadSlice(slicePath("quali-to-race-10s"));
  const states = toStates(slice);

  it("produces a valid SimState for every tick", () => {
    for (const s of states) expect(isSimState(s)).toBe(true);
  });

  it("starts in qualifying cooldown with the checkered flag", () => {
    const s = states[0] as SimState;
    expect(s.session).toMatchObject({
      type: "qualifying",
      phase: "cooldown",
      timing: "laps-or-time",
      timeTotalS: 480,
      lapsTotal: 2,
      lapsRemaining: 2,
    });
    expect(s.flags?.checkered).toBe(true);
    expect(s.session.timeRemainingS).toBeCloseTo(4.27, 1);
  });

  it("switches to the race session in the garage phase", () => {
    const race = firstIndex(states, (s) => s.session.type === "race");
    expect(timeOf(slice, race)).toBeGreaterThan(564.7);
    expect(timeOf(slice, race)).toBeLessThan(564.9);
    expect(states[race]?.session).toMatchObject({
      phase: "garage",
      timing: "time",
      timeTotalS: 1200,
      lapsTotal: null,
    });
    expect(states.slice(0, race).every((s) => s.session.type === "qualifying")).toBe(true);
    expect(states.slice(race).every((s) => s.session.type === "race")).toBe(true);
    expect(states.at(-1)?.session.timeRemainingS).toBeCloseTo(115.8 - 0.3, -1);
  });

  it("re-parses the YAML when it changes and follows the session number", () => {
    const counts = new Set(slice.ticks.map((t) => t.yamlCount));
    expect([...counts].sort()).toEqual([1, 2, 3]);
    const infos = new Set(slice.ticks.map((t) => t.info));
    expect(infos.size).toBe(3);
    expect([...infos].map((i) => i?.currentSessionNum)).toEqual([1, 2, 2]);
  });

  it("has no live car data while the player is out of the world", () => {
    const s = states[0] as SimState;
    expect(s.player.fuelL).toBeNull(); // the gauge reads 0 in the garage
    expect(s.player.inputs).toEqual({ throttle: null, brake: null, clutch: null, steer: null });
    expect(s.player.speedMps).toBeNull();
    expect(s.player.fuelCapacityL).toBe(52);
  });
});

describe("IracingAdapter on synthetic buffers", () => {
  const N = 4;
  const vars: SyntheticVar[] = [
    { name: "SessionTime", type: VarType.Double },
    { name: "SessionNum", type: VarType.Int },
    { name: "SessionState", type: VarType.Int },
    { name: "SessionFlags", type: VarType.Bitfield },
    { name: "SessionTimeRemain", type: VarType.Double },
    { name: "SessionTimeTotal", type: VarType.Double },
    { name: "SessionLapsRemainEx", type: VarType.Int },
    { name: "SessionLapsTotal", type: VarType.Int },
    { name: "PlayerCarIdx", type: VarType.Int },
    { name: "CamCarIdx", type: VarType.Int },
    { name: "Throttle", type: VarType.Float },
    { name: "Brake", type: VarType.Float },
    { name: "Clutch", type: VarType.Float },
    { name: "SteeringWheelAngle", type: VarType.Float },
    { name: "SteeringWheelAngleMax", type: VarType.Float },
    { name: "Gear", type: VarType.Int },
    { name: "Speed", type: VarType.Float },
    { name: "RPM", type: VarType.Float },
    { name: "FuelLevel", type: VarType.Float },
    { name: "EngineWarnings", type: VarType.Bitfield },
    { name: "CarLeftRight", type: VarType.Int },
    { name: "TrackWetness", type: VarType.Int },
    { name: "AirTemp", type: VarType.Float },
    { name: "TrackTempCrew", type: VarType.Float },
    { name: "PlayerCarMyIncidentCount", type: VarType.Int },
    { name: "CarIdxPosition", type: VarType.Int, count: N },
    { name: "CarIdxClassPosition", type: VarType.Int, count: N },
    { name: "CarIdxLap", type: VarType.Int, count: N },
    { name: "CarIdxLapCompleted", type: VarType.Int, count: N },
    { name: "CarIdxLapDistPct", type: VarType.Float, count: N },
    { name: "CarIdxTrackSurface", type: VarType.Int, count: N },
    { name: "CarIdxOnPitRoad", type: VarType.Bool, count: N },
    { name: "CarIdxLastLapTime", type: VarType.Float, count: N },
    { name: "CarIdxBestLapTime", type: VarType.Float, count: N },
    { name: "CarIdxEstTime", type: VarType.Float, count: N },
    { name: "CarIdxClass", type: VarType.Int, count: N },
    ...(["LF", "RF", "LR", "RR"] as const).flatMap((c) =>
      ["tempCL", "tempCM", "tempCR", "wearL", "wearM", "wearR"].map((suffix): SyntheticVar => ({
        name: `${c}${suffix}`,
        type: VarType.Float,
      })),
    ),
  ];
  const layout = syntheticLayout(vars);
  const adapter = IracingAdapter.fromHeaderBytes(layout.header);
  const info: IracingSessionInfo = {
    trackName: "Test Ring",
    trackConfig: "Grand Prix",
    trackLengthM: 3200,
    pitSpeedLimitMps: 20,
    incidentLimit: 17,
    pitStallLapDistPct: 0.97,
    currentSessionNum: 0,
    sessions: [
      { sessionNum: 0, typeName: "Race", type: "race", lapsLimit: 12, timeLimitS: null },
      { sessionNum: 1, typeName: "Warmup", type: "warmup", lapsLimit: null, timeLimitS: 300 },
    ],
    driverCarIdx: 1,
    fuelCapacityL: 80,
    drivers: [
      {
        carIdx: 1,
        driverName: "Me",
        carName: "GT",
        carNumber: "7",
        classId: "10",
        className: "Fast",
        classColour: "#ffda59",
        iRating: 2000,
        license: "A 3.41",
        isPaceCar: false,
        teamName: "Team Zofia Świątkowska",
      },
    ],
  };

  const base = {
    SessionTime: 100.5,
    SessionNum: 0,
    SessionState: 4,
    SessionFlags: 0,
    SessionTimeRemain: 604800,
    SessionTimeTotal: 604800,
    SessionLapsRemainEx: 9,
    SessionLapsTotal: 12,
    PlayerCarIdx: 1,
    CamCarIdx: 1,
    Clutch: 1,
    SteeringWheelAngleMax: 4,
    TrackWetness: 1,
    CarIdxTrackSurface: [-1, 3, 3, -1],
    CarIdxClass: [-1, 10, 10, -1],
  };
  const run = (values: Record<string, number | number[]>, i: IracingSessionInfo | null = info) =>
    adapter.toSimState(layout.buffer({ ...base, ...values }), i);

  it("produces a valid SimState", () => {
    expect(isSimState(run({}))).toBe(true);
    expect(isSimState(run({}, null))).toBe(true);
  });

  it.each([
    [0, null],
    [1, "garage"],
    [2, "gridding"],
    [3, "formation"],
    [4, "racing"],
    [5, "checkered"],
    [6, "cooldown"],
    [7, null],
  ] as const)("SessionState %i is %s", (value, phase) => {
    expect(run({ SessionState: value }).session.phase).toBe(phase);
  });

  it("picks the session type by SessionNum and derives the timing", () => {
    expect(run({}).session).toMatchObject({
      type: "race",
      timing: "laps",
      lapsTotal: 12,
      lapsRemaining: 9,
      timeTotalS: null,
      timeRemainingS: null,
    });
    expect(
      run({
        SessionNum: 1,
        SessionTimeTotal: 300,
        SessionTimeRemain: 120.5,
        SessionLapsTotal: 32767,
        SessionLapsRemainEx: 32767,
      }).session,
    ).toMatchObject({
      type: "warmup",
      timing: "time",
      timeTotalS: 300,
      timeRemainingS: 120.5,
      lapsTotal: null,
      lapsRemaining: null,
    });
    expect(run({ SessionTimeTotal: 600 }).session.timing).toBe("laps-or-time");
    expect(run({ SessionLapsTotal: 32767, SessionLapsRemainEx: 32767 }).session.timing).toBeNull();
    expect(run({ SessionNum: 5 }).session.type).toBeNull();
    expect(run({}, null).session).toMatchObject({
      type: null,
      trackName: null,
      trackLengthM: null,
    });
  });

  it("takes the lap limit from the session YAML when the live total is not available", () => {
    const other = syntheticLayout(vars.filter((v) => v.name !== "SessionLapsTotal"));
    const withoutTotal = Object.fromEntries(
      Object.entries(base).filter(([name]) => name !== "SessionLapsTotal"),
    );
    const noTotal = IracingAdapter.fromHeaderBytes(other.header);
    const state = noTotal.toSimState(other.buffer(withoutTotal), info);
    expect(state.session).toMatchObject({ lapsTotal: 12, timing: "laps" });
    // An unlimited live value is an answer and is not overridden by the YAML.
    expect(run({ SessionLapsTotal: 32767 }).session.lapsTotal).toBeNull();
  });

  it("maps the session info fields", () => {
    const s = run({});
    expect(s.session).toMatchObject({
      trackName: "Test Ring",
      trackLengthM: 3200,
      pitSpeedLimitMps: 20,
    });
    expect(s.player.fuelCapacityL).toBe(80);
    expect(s.tickTimeS).toBe(100.5);
    expect(s.playerCarIdx).toBe(1);
    expect(s.focusCarIdx).toBe(1);
  });

  it("decodes SessionFlags bits", () => {
    const flagsOf = (bits: number) => {
      const f = run({ SessionFlags: bits }).flags;
      return Object.entries(f ?? {})
        .filter(([, on]) => on)
        .map(([k]) => k);
    };
    expect(flagsOf(0)).toEqual([]);
    expect(flagsOf(0x1)).toEqual(["checkered"]);
    expect(flagsOf(0x2)).toEqual(["white"]);
    expect(flagsOf(0x4)).toEqual(["green"]);
    expect(flagsOf(0x8)).toEqual(["yellow"]);
    expect(flagsOf(0x100)).toEqual(["yellow"]);
    expect(flagsOf(0x10)).toEqual(["red"]);
    expect(flagsOf(0x20)).toEqual(["blue"]);
    expect(flagsOf(0x4000)).toEqual(["fullCourseYellow"]);
    expect(flagsOf(0x10000)).toEqual(["black"]);
    expect(flagsOf(0x20000)).toEqual(["black"]);
    // furled (warning), repair and debris have no SimState slot: ignored, never shown as black
    expect(flagsOf(0x80000)).toEqual([]);
    expect(flagsOf(0x100000)).toEqual([]);
    expect(flagsOf(0x80)).toEqual([]);
    expect(flagsOf(0x80000000 + 0x4)).toEqual(["green"]); // start-light bits are ignored
    expect(flagsOf(0x10000000 + 0x40000 + 0x400)).toEqual([]); // startHidden, servicible, greenHeld
  });

  it("maps wetness 1..7 to 0..1 and 0 to unknown", () => {
    expect(run({ TrackWetness: 0 }).conditions.wetness).toBeNull();
    expect(run({ TrackWetness: 1 }).conditions.wetness).toBe(0);
    expect(run({ TrackWetness: 4 }).conditions.wetness).toBeCloseTo(0.5, 6);
    expect(run({ TrackWetness: 7 }).conditions.wetness).toBe(1);
    expect(run({ TrackWetness: 8 }).conditions.wetness).toBeNull();
  });

  it("flips the steering sign, clamps it and inverts the clutch", () => {
    const left = run({ SteeringWheelAngle: 2, Clutch: 0.25, Throttle: 1.2, Brake: -0.1 });
    expect(left.player.inputs.steer).toBe(-0.5); // iRacing positive = left; SimState positive = right
    expect(left.player.inputs.clutch).toBeCloseTo(0.75, 6);
    expect(left.player.inputs.throttle).toBe(1);
    expect(left.player.inputs.brake).toBe(0);
    expect(run({ SteeringWheelAngle: -8 }).player.inputs.steer).toBe(1);
    expect(run({ SteeringWheelAngle: 0 }).player.inputs.steer).toBe(0);
    expect(Object.is(run({ SteeringWheelAngle: 0 }).player.inputs.steer, 0)).toBe(true);
    expect(run({ SteeringWheelAngleMax: 0, SteeringWheelAngle: 1 }).player.inputs.steer).toBeNull();
    expect(run({ Clutch: 1 }).player.inputs.clutch).toBe(0);
  });

  it("reads the pit limiter bit and the spotter", () => {
    expect(run({ EngineWarnings: 0x10 }).player.pitLimiter).toBe(true);
    expect(run({ EngineWarnings: 0x20 | 0x01 }).player.pitLimiter).toBe(false);
    const names = ["clear", "left", "right", "both", "twoLeft", "twoRight"] as const;
    names.forEach((n, i) => expect(run({ CarLeftRight: i + 1 }).player.carLeftRight).toBe(n));
    expect(run({ CarLeftRight: 0 }).player.carLeftRight).toBeNull();
    expect(run({ CarLeftRight: 9 }).player.carLeftRight).toBeNull();
  });

  it("treats iRacing's invalid values as unknown per car", () => {
    const s = run({
      CarIdxPosition: [0, 0, 3, -1],
      CarIdxClassPosition: [0, 0, 2, -1],
      CarIdxLap: [-1, 0, 4, -1],
      CarIdxLapCompleted: [-1, -1, 3, -1],
      CarIdxLapDistPct: [-1, -1, 0.25, -1],
      CarIdxLastLapTime: [-1, -1, 91.5, -1],
      CarIdxBestLapTime: [-1, 0, 90.25, -1],
      CarIdxEstTime: [0, 0, 22.5, 0],
    });
    expect(s.cars.map((c) => c.carIdx)).toEqual([1]); // only drivers from the session info
    const me = s.cars[0];
    expect(me).toMatchObject({
      position: null,
      classPosition: null,
      lapInProgress: null,
      lapsCompleted: null,
      lapDistPct: null,
      lastLapS: null,
      bestLapS: null,
      estTimeS: 0,
      isPlayer: true,
      driverName: "Me",
      classColour: null,
    });
    const noInfo = run(
      {
        CarIdxPosition: [0, 0, 3, -1],
        CarIdxClassPosition: [0, 0, 2, -1],
        CarIdxLap: [-1, 0, 4, -1],
        CarIdxLapCompleted: [-1, -1, 3, -1],
        CarIdxLapDistPct: [-1, -1, 0.25, -1],
        CarIdxLastLapTime: [-1, -1, 91.5, -1],
        CarIdxBestLapTime: [-1, 0, 90.25, -1],
        CarIdxEstTime: [0, 0, 22.5, 0],
      },
      null,
    );
    // Without session info the cars come from the class slots the sim reports.
    expect(noInfo.cars.map((c) => c.carIdx)).toEqual([1, 2]);
    expect(noInfo.cars[1]).toMatchObject({
      position: 3,
      classPosition: 2,
      lapInProgress: 4,
      lapsCompleted: 3,
      lapDistPct: 0.25,
      lastLapS: 91.5,
      bestLapS: 90.25,
      estTimeS: 22.5,
      isPlayer: false,
      driverName: null,
      isOnTrack: true,
      inPitStall: false,
    });
  });

  it("derives pit stall and on-track from the track surface", () => {
    const s = run({ CarIdxTrackSurface: [-1, 1, 3, -1], CarIdxOnPitRoad: [0, 1, 0, 0] }, null);
    expect(s.cars[0]).toMatchObject({ inPitStall: true, isOnTrack: true, onPitRoad: true });
    const off = run({ CarIdxTrackSurface: [-1, 0, 3, -1] }, null);
    expect(off.cars[0]).toMatchObject({ inPitStall: false, isOnTrack: true });
  });

  it("nulls fuel and inputs while the player car is not in the world", () => {
    const out = run({ CarIdxTrackSurface: [-1, -1, 3, -1], FuelLevel: 0, Throttle: 1, Gear: 3 });
    expect(out.player.fuelL).toBeNull();
    expect(out.player.inputs.throttle).toBeNull();
    expect(out.player.gear).toBeNull();
    expect(out.cars[0]?.isOnTrack).toBe(false);
    expect(run({ FuelLevel: 12.5 }).player.fuelL).toBe(12.5);
  });

  it("maps tyre corners, treating all-zero data as absent", () => {
    const tyres = run({
      LFtempCL: 60,
      LFtempCM: 70,
      LFtempCR: 80,
      LFwearL: 0.9,
      LFwearM: 0.8,
      LFwearR: 0.7,
      RFtempCL: 61,
      RFtempCM: 71,
      RFtempCR: 81,
      RFwearL: 1,
      RFwearM: 1,
      RFwearR: 1,
      LRtempCL: 62,
      LRtempCM: 72,
      LRtempCR: 82,
      LRwearL: 0.5,
      LRwearM: 0.5,
      LRwearR: 0.5,
      RRtempCL: 63,
      RRtempCM: 73,
      RRtempCR: 83,
      RRwearL: 0.25,
      RRwearM: 0.25,
      RRwearR: 0.25,
    }).player.tyres;
    expect(tyres?.fl.temps).toEqual({ inner: 80, middle: 70, outer: 60 });
    expect(tyres?.rl.temps).toEqual({ inner: 82, middle: 72, outer: 62 });
    expect(tyres?.fr.temps).toEqual({ inner: 61, middle: 71, outer: 81 });
    expect(tyres?.rr.temps).toEqual({ inner: 63, middle: 73, outer: 83 });
    expect(tyres?.fl.wear).toBeCloseTo(0.2, 5);
    expect(tyres?.fr.wear).toBe(0);
    expect(tyres?.rl.wear).toBe(0.5);
    expect(tyres?.rr.wear).toBe(0.75);
    expect(tyres?.fl.pressureKpa).toBeNull();
    expect(run({}).player.tyres).toBeNull();
  });

  it("nulls the player's live values when out of the world or without a player car", () => {
    const live = {
      Throttle: 0.5,
      Brake: 0.2,
      Gear: 3,
      Speed: 40,
      RPM: 5000,
      FuelLevel: 30,
      EngineWarnings: 0x10,
      CarLeftRight: 2,
      LFtempCL: 60,
      LFwearL: 0.9,
      LFwearM: 0.9,
      LFwearR: 0.9,
    };
    const driving = run(live);
    expect(driving.player.inputs.throttle).toBe(0.5);
    expect(driving.player.tyres).not.toBeNull();
    const spectating = run({ ...live, CarIdxTrackSurface: [-1, -1, 3, 3] });
    for (const s of [spectating, run({ ...live, PlayerCarIdx: -1 })]) {
      expect(s.player.inputs).toEqual({ throttle: null, brake: null, clutch: null, steer: null });
      expect(s.player).toMatchObject({
        gear: null,
        speedMps: null,
        rpm: null,
        fuelL: null,
        tyres: null,
        pitLimiter: null,
        carLeftRight: null,
      });
      expect(s.player.fuelCapacityL).toBe(80);
    }
    // Camera on another car while still driving: values stay.
    const cam = run({ ...live, CamCarIdx: 2 });
    expect(cam.focusCarIdx).toBe(2);
    expect(cam.player.inputs.throttle).toBe(0.5);
    expect(cam.player.fuelL).toBe(30);
    expect(run({ ...live, PlayerCarIdx: -1 }).playerCarIdx).toBeNull();
    expect(run({ ...live, PlayerCarIdx: -1 }).cars.every((c) => c.isPlayer === null)).toBe(true);
  });

  it("keeps class positions per class in a multiclass field", () => {
    const multi: IracingSessionInfo = {
      ...info,
      drivers: [1, 2, 3].map((carIdx) => ({
        ...(info.drivers[0] as IracingSessionInfo["drivers"][number]),
        carIdx,
        classId: carIdx === 2 ? "20" : "10",
        className: carIdx === 2 ? "Slow" : "Fast",
        classColour: carIdx === 2 ? "#33ceff" : "#ffda59",
      })),
    };
    const s = run(
      {
        CarIdxPosition: [0, 1, 2, 3],
        CarIdxClassPosition: [0, 1, 1, 2],
        CarIdxTrackSurface: [-1, 3, 3, 3],
      },
      multi,
    );
    const by = (i: number) => s.cars.find((c) => c.carIdx === i);
    expect([1, 2, 3].map((i) => by(i)?.position)).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((i) => by(i)?.classPosition)).toEqual([1, 1, 2]);
    expect([1, 2, 3].map((i) => by(i)?.className)).toEqual(["Fast", "Slow", "Fast"]);
    expect(by(2)?.classColour).toBe("#33ceff");
  });

  it("shows no class colour in a single-class session", () => {
    const single: IracingSessionInfo = {
      ...info,
      drivers: [1, 2].map((carIdx) => ({
        ...(info.drivers[0] as IracingSessionInfo["drivers"][number]),
        carIdx,
        classId: "10",
        className: "GT3",
        classColour: "#ffffff",
      })),
    };
    const s = run({ CarIdxTrackSurface: [-1, 3, 3] }, single);
    expect(s.cars.length).toBe(2);
    expect(s.cars.every((c) => c.classColour === null)).toBe(true);
  });

  it("reports nulls for everything the sim does not provide", () => {
    const sparse = syntheticLayout([{ name: "SessionTime", type: VarType.Double }]);
    const s = IracingAdapter.fromHeaderBytes(sparse.header).toSimState(
      sparse.buffer({ SessionTime: 5 }),
      null,
    );
    expect(isSimState(s)).toBe(true);
    expect(s.cars).toEqual([]);
    expect(s.flags).toBeNull();
    expect(s.playerCarIdx).toBeNull();
    expect(s.player.gear).toBeNull();
    expect(s.player.tyres).toBeNull();
    expect(s.player.pitLimiter).toBeNull();
    expect(s.conditions).toEqual({
      airTempC: null,
      trackTempC: null,
      wetness: null,
      precipitation: null,
      humidity: null,
      fogLevel: null,
      windSpeedMps: null,
      windDirRad: null,
      declaredWet: null,
    });
    expect(s.player.energyFraction).toBeNull();
  });
});

describe("IracingAdapter field data (synthetic)", () => {
  const vars: SyntheticVar[] = [
    { name: "SessionTime", type: VarType.Double },
    { name: "PlayerCarIdx", type: VarType.Int },
    { name: "CarIdxPosition", type: VarType.Int, count: 2 },
    { name: "CarIdxTrackSurface", type: VarType.Int, count: 2 },
    { name: "SessionTimeOfDay", type: VarType.Float },
    { name: "WindVel", type: VarType.Float },
    { name: "WindDir", type: VarType.Float },
    { name: "RelativeHumidity", type: VarType.Float },
    { name: "FogLevel", type: VarType.Float },
    { name: "Precipitation", type: VarType.Float },
    { name: "dcBrakeBias", type: VarType.Float },
  ];
  const layout = syntheticLayout(vars);
  const adapter = IracingAdapter.fromHeaderBytes(layout.header);
  const info: IracingSessionInfo = {
    trackName: null,
    trackConfig: null,
    trackLengthM: null,
    pitSpeedLimitMps: null,
    incidentLimit: 25,
    pitStallLapDistPct: 0.955,
    currentSessionNum: 0,
    sessions: [],
    driverCarIdx: 0,
    fuelCapacityL: null,
    drivers: [
      {
        carIdx: 0,
        driverName: "Max Example",
        carName: null,
        carNumber: null,
        classId: null,
        className: null,
        classColour: null,
        iRating: null,
        license: null,
        isPaceCar: false,
        teamName: "Écurie José María Pérez",
      },
    ],
  };
  const run = (values: Record<string, number | number[]>, i: IracingSessionInfo | null = info) =>
    adapter.toSimState(
      layout.buffer({ PlayerCarIdx: 0, CarIdxTrackSurface: [3, 3], ...values }),
      i,
    );

  it("copies session and car facts from the session info and the time of day from the var", () => {
    const s = run({ SessionTimeOfDay: 45028 });
    expect(s.session.incidentLimit).toBe(25);
    expect(s.session.timeOfDayS).toBe(45028);
    expect(s.player.pitStallLapDistPct).toBe(0.955);
    expect(s.cars[0]?.teamName).toBe("Écurie José María Pérez");
    expect(s.cars[0]?.worldPos).toBeNull();
    expect(s.cars[0]?.fuelFraction).toBeNull();
    const none = run({}, null);
    expect(none.session.incidentLimit).toBeNull();
    expect(none.player.pitStallLapDistPct).toBeNull();
  });

  it("reads the weather and wraps the wind direction into 0..2pi", () => {
    const s = run({
      WindVel: 3.5,
      WindDir: 6.9,
      RelativeHumidity: 0.75,
      FogLevel: 0.25,
      Precipitation: 0.5,
    });
    expect(s.conditions.windSpeedMps).toBeCloseTo(3.5, 5);
    expect(s.conditions.windDirRad).toBeCloseTo(6.9 - 2 * Math.PI, 5);
    expect(s.conditions.humidity).toBeCloseTo(0.75, 5);
    expect(s.conditions.fogLevel).toBeCloseTo(0.25, 5);
    expect(s.conditions.precipitation).toBeCloseTo(0.5, 5);
    expect(run({ WindDir: -0.5 }).conditions.windDirRad).toBeCloseTo(2 * Math.PI - 0.5, 5);
  });

  it("leaves everything null when the build has none of the variables", () => {
    const sparse = syntheticLayout([{ name: "SessionTime", type: VarType.Double }]);
    const s = IracingAdapter.fromHeaderBytes(sparse.header).toSimState(
      sparse.buffer({ SessionTime: 1 }),
      null,
    );
    expect(s.session.timeOfDayS).toBeNull();
    expect(s.player.brakeBias).toBeNull();
    expect(s.conditions.windSpeedMps).toBeNull();
  });

  it.each([
    [55.9646, 0.559646],
    [30, 0.3],
    [80, 0.8],
    [0, null], // not set / garage
    [29.9, null],
    [80.1, null],
    [-3, null], // an offset-style value
  ] as const)("brake bias %f gives %s", (raw, expected) => {
    const bias = run({ dcBrakeBias: raw }).player.brakeBias;
    if (expected === null) expect(bias).toBeNull();
    else expect(bias).toBeCloseTo(expected, 5);
  });

  it("gives no brake bias while the player is not in the world", () => {
    expect(run({ dcBrakeBias: 55, CarIdxTrackSurface: [-1, -1] }).player.brakeBias).toBeNull();
  });
});

describe("performance", async () => {
  it("decodes one tick into a SimState in under 0.5 ms on average", async () => {
    const slice = await loadSlice(slicePath("race-start-20s"));
    const adapter = new IracingAdapter(slice.decoder);
    for (const t of slice.ticks.slice(0, 100)) adapter.toSimState(t.buffer, t.info); // warm up
    const start = performance.now();
    for (const t of slice.ticks) adapter.toSimState(t.buffer, t.info);
    const perTickMs = (performance.now() - start) / slice.ticks.length;
    console.log(
      `iracing adapter: ${perTickMs.toFixed(4)} ms per tick over ${slice.ticks.length} ticks`,
    );
    expect(perTickMs).toBeLessThan(0.5);
  });
});

const recording = process.env["OVERLAY_IRACING_RECORDING"];

describe("local full recording", () => {
  it.skipIf(!recording)(
    "converts every 10th tick to a valid SimState",
    async () => {
      const reader = new FixtureReader(createReadStream(recording ?? ""));
      const cache = new SessionInfoCache();
      let adapter: IracingAdapter | undefined;
      let info: IracingSessionInfo | null = null;
      let yamlCount = 0;
      let n = 0;
      let converted = 0;
      const types = new Set<string>();
      const phases = new Set<string>();
      for await (const record of reader.records()) {
        if (record.kind === RecordKind.IracingHeader) {
          adapter = IracingAdapter.fromHeaderBytes(record.payload);
        } else if (record.kind === RecordKind.IracingSessionYaml) {
          info = cache.update(++yamlCount, () => decodeSessionYaml(record.payload));
        } else if (record.kind === RecordKind.IracingVarBuffer && adapter !== undefined) {
          if (n++ % 10 !== 0) continue;
          const state = adapter.toSimState(record.payload.subarray(4), info);
          if (!isSimState(state)) throw new Error(`tick ${n} is not a SimState`);
          converted++;
          if (state.session.type !== null) types.add(state.session.type);
          if (state.session.phase !== null) phases.add(state.session.phase);
        }
      }
      console.log(
        `converted ${converted} ticks; types ${[...types].join(",")}; phases ${[...phases].join(",")}`,
      );
      expect(converted).toBeGreaterThan(1000);
      expect(types.has("race")).toBe(true);
      expect(phases.has("racing")).toBe(true);
    },
    600_000,
  );
});
