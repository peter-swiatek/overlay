import { parse } from "yaml";
import type { SessionType } from "../../model/sim-state";

/**
 * iRacing's session info is a YAML-looking text (Windows-1252, see decodeSessionYaml) that is not always valid YAML:
 * names such as `Bob: the Builder`, `#1 Racing` or `*Star*` appear unquoted. We therefore quote
 * every `key: value` scalar ourselves and parse with the failsafe schema, so every value is a
 * string and nothing is coerced (a driver called `null` or `yes` stays a name). Numbers are
 * converted explicitly by the extractors below.
 *
 * Only WeekendInfo, SessionInfo and DriverInfo are parsed, each on its own, so a problem in a
 * section we do not use (CarSetup, CameraInfo) can never cost us the ones we do.
 */

export interface IracingSessionEntry {
  sessionNum: number;
  /** iRacing's own SessionType text, e.g. "Lone Qualify". */
  typeName: string | null;
  type: SessionType | null;
  /** Lap limit, or null for "unlimited". */
  lapsLimit: number | null;
  /** Time limit in seconds, or null for "unlimited". */
  timeLimitS: number | null;
}

export interface IracingDriver {
  carIdx: number;
  driverName: string | null;
  carName: string | null;
  carNumber: string | null;
  classId: string | null;
  className: string | null;
  /** CSS hex, e.g. "#ffda59". */
  classColour: string | null;
  iRating: number | null;
  license: string | null;
  isPaceCar: boolean;
}

export interface IracingSessionInfo {
  trackName: string | null;
  /** WeekendInfo TrackConfigName, e.g. "Full Course". */
  trackConfig: string | null;
  trackLengthM: number | null;
  pitSpeedLimitMps: number | null;
  currentSessionNum: number | null;
  sessions: IracingSessionEntry[];
  driverCarIdx: number | null;
  /** DriverCarFuelMaxLtr x DriverCarMaxFuelPct. */
  fuelCapacityL: number | null;
  /** Spectators are left out; the pace car is kept and flagged. */
  drivers: IracingDriver[];
}

type Dict = Record<string, unknown>;

const SECTIONS = ["WeekendInfo", "SessionInfo", "DriverInfo"] as const;

const KEY_LINE = /^(\s*(?:- )?)([A-Za-z_]\w*):(?:[ \t]+(.*))?$/;

export function parseSessionYaml(text: string): IracingSessionInfo {
  const sections = splitSections(text);
  const weekend = parseSection(sections.get("WeekendInfo"));
  const session = parseSection(sections.get("SessionInfo"));
  const driver = parseSection(sections.get("DriverInfo"));
  const drivers = asArray(driver["Drivers"]).flatMap((d) => {
    const parsed = extractDriver(asDict(d));
    return parsed === null ? [] : [parsed];
  });
  return {
    trackName: str(weekend["TrackDisplayName"]) ?? str(weekend["TrackName"]),
    trackConfig: str(weekend["TrackConfigName"]),
    trackLengthM: lengthToMetres(str(weekend["TrackLength"])),
    pitSpeedLimitMps: speedToMps(str(weekend["TrackPitSpeedLimit"])),
    currentSessionNum: int(session["CurrentSessionNum"]),
    sessions: asArray(session["Sessions"]).flatMap((s) => {
      const parsed = extractSession(asDict(s));
      return parsed === null ? [] : [parsed];
    }),
    driverCarIdx: int(driver["DriverCarIdx"]),
    fuelCapacityL: fuelCapacity(driver),
    drivers,
  };
}

/**
 * Re-parses only when iRacing's SessionInfoUpdate counter (irsdk header, offset 12) changes.
 * The text is passed as a callback so the up to 512 KB YAML area is not even decoded on the
 * ticks where the counter is unchanged.
 *
 * A parse of the fixture YAML (about 45 KB) takes tens of milliseconds, far over the 60 Hz tick
 * budget. The telemetry process (M1-6) must run parses off the 60 Hz path (a worker, or at least
 * a deferred task) and keep using the previous info until the new one is ready.
 */
export class SessionInfoCache {
  private lastCounter: number | undefined;
  private current: IracingSessionInfo | null = null;

  update(updateCounter: number, readText: () => string | null): IracingSessionInfo | null {
    if (this.lastCounter === updateCounter && this.current !== null) return this.current;
    const text = readText();
    if (text !== null) {
      this.current = parseSessionYaml(text);
      this.lastCounter = updateCounter;
    }
    return this.current;
  }
}

function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string[]>();
  let name: string | null = null;
  for (const raw of text.replace(/\0/g, "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const top = /^([A-Za-z]\w*):\s*$/.exec(line);
    if (top !== null) {
      name = top[1] ?? null;
      if (name !== null) out.set(name, []);
    } else if (name !== null && !/^\S/.test(line)) {
      out.get(name)?.push(line);
    } else if (/^\S/.test(line)) {
      name = null;
    }
  }
  const joined = new Map<string, string>();
  for (const wanted of SECTIONS) {
    const lines = out.get(wanted);
    if (lines !== undefined) joined.set(wanted, lines.map(quoteScalars).join("\n"));
  }
  return joined;
}

function quoteScalars(line: string): string {
  const match = KEY_LINE.exec(line);
  if (match === null) return line;
  const [, prefix = "", key = "", rawValue] = match;
  const value = (rawValue ?? "").trim();
  if (value === "" || isJsonString(value)) return line;
  return `${prefix}${key}: ${JSON.stringify(value)}`;
}

function isJsonString(value: string): boolean {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return false;
  try {
    return typeof JSON.parse(value) === "string";
  } catch {
    return false;
  }
}

function parseSection(body: string | undefined): Dict {
  if (body === undefined) return {};
  try {
    return asDict(parse(body, { schema: "failsafe", maxAliasCount: 0, uniqueKeys: false }));
  } catch {
    return {};
  }
}

function extractSession(s: Dict): IracingSessionEntry | null {
  const sessionNum = int(s["SessionNum"]);
  if (sessionNum === null) return null;
  const typeName = str(s["SessionType"]);
  return {
    sessionNum,
    typeName,
    type: typeName === null ? null : mapSessionType(typeName),
    lapsLimit: int(s["SessionLaps"]),
    timeLimitS: quantity(str(s["SessionTime"]))?.value ?? null,
  };
}

export function mapSessionType(name: string): SessionType {
  const lower = name.toLowerCase();
  if (lower.includes("qualify")) return "qualifying";
  if (lower.includes("race")) return "race";
  if (lower.includes("warmup")) return "warmup";
  if (lower.includes("practice") || lower.includes("testing")) return "practice";
  return "other";
}

function extractDriver(d: Dict): IracingDriver | null {
  const carIdx = int(d["CarIdx"]);
  if (carIdx === null || str(d["IsSpectator"]) === "1") return null;
  return {
    carIdx,
    driverName: str(d["UserName"]),
    carName: str(d["CarScreenName"]),
    carNumber: str(d["CarNumber"]),
    classId: str(d["CarClassID"]),
    className: str(d["CarClassShortName"]),
    classColour: hexColour(str(d["CarClassColor"])),
    iRating: int(d["IRating"]),
    license: str(d["LicString"]),
    isPaceCar: str(d["CarIsPaceCar"]) === "1",
  };
}

function fuelCapacity(driver: Dict): number | null {
  const max = num(driver["DriverCarFuelMaxLtr"]);
  const pct = num(driver["DriverCarMaxFuelPct"]);
  if (max === null || pct === null || max <= 0 || pct <= 0) return null;
  return max * pct;
}

/** "0xffda59" -> "#ffda59". */
function hexColour(value: string | null): string | null {
  const match = value === null ? null : /^0x([0-9a-f]{1,6})$/i.exec(value);
  return match?.[1] === undefined ? null : `#${match[1].toLowerCase().padStart(6, "0")}`;
}

function lengthToMetres(value: string | null): number | null {
  const q = quantity(value);
  if (q === null) return null;
  switch (q.unit) {
    case "km":
      return q.value * 1000;
    case "m":
      return q.value;
    case "mi":
      return q.value * 1609.344;
    default:
      return null;
  }
}

function speedToMps(value: string | null): number | null {
  const q = quantity(value);
  if (q === null) return null;
  switch (q.unit) {
    case "kph":
    case "km/h":
      return q.value / 3.6;
    case "mph":
      return q.value * 0.44704;
    case "m/s":
      return q.value;
    default:
      return null;
  }
}

function quantity(value: string | null): { value: number; unit: string } | null {
  const match = value === null ? null : /^(-?\d+(?:\.\d+)?)\s*([A-Za-z/]*)$/.exec(value.trim());
  if (match?.[1] === undefined) return null;
  return { value: Number(match[1]), unit: (match[2] ?? "").toLowerCase() };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  const s = str(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function int(value: unknown): number | null {
  const n = num(value);
  return n === null || !Number.isInteger(n) ? null : n;
}

function asDict(value: unknown): Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
