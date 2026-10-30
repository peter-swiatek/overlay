/**
 * Privacy redaction for committed fixture slices. Recordings of online sessions hold other
 * drivers' names and user IDs; slices that go into the repository must not.
 */

// ---------------------------------------------------------------------------------------------
// iRacing session YAML
// ---------------------------------------------------------------------------------------------

const SYNTHETIC_USER_ID_BASE = 900_000;
const SYNTHETIC_TEAM_ID_BASE = 800_000;

const NAME_KEYS = new Set(["UserName", "AbbrevName", "Initials", "TeamName"]);
const LINE = /^(\s*(?:- )?)(\w+):(.*?)(\r?)$/;
const CAR_IDX_LINE = /^\s*(?:- )?CarIdx:\s*(-?\d+)/;

/**
 * Replaces names, user and team IDs and the local telemetry path in an iRacing session YAML.
 * Names become `Driver <carIdx>`, user IDs and non-zero team IDs become synthetic numbers derived
 * from the carIdx. Works line by line on latin1 text so every other byte survives untouched.
 */
export function redactIracingYaml(yaml: string): string {
  let driverCarIdx: number | undefined;
  let listCarIdx: number | undefined;
  const out: string[] = [];
  for (const line of yaml.split("\n")) {
    const carIdx = CAR_IDX_LINE.exec(line);
    if (carIdx) listCarIdx = Number(carIdx[1]);
    const m = LINE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, prefix = "", key = "", value = "", eol = ""] = m;
    if (key === "DriverCarIdx") driverCarIdx = Number(value.trim());
    out.push(redactYamlLine(prefix, key, value, eol, listCarIdx, driverCarIdx) ?? line);
  }
  return out.join("\n");
}

/**
 * The irsdk header record carries a live copy of the session YAML at `sessionInfoOffset`
 * (NUL padded, `sessionInfoLen` bytes). Redacts that copy in place, keeping the record size.
 */
export function redactIracingHeader(header: Buffer): Buffer {
  if (header.length < 40) return header;
  const offset = header.readInt32LE(20);
  const length = Math.min(header.readInt32LE(16), header.length - offset);
  if (offset < 0 || length <= 0) return header;
  const region = header.subarray(offset, offset + length);
  const end = region.indexOf(0);
  const text = region.subarray(0, end < 0 ? region.length : end).toString("latin1");
  const redacted = Buffer.from(redactIracingYaml(text), "latin1");
  if (redacted.length > length) throw new Error("Redacted session YAML does not fit its region");
  const out = Buffer.from(header);
  out.fill(0, offset, offset + length);
  redacted.copy(out, offset);
  return out;
}

function redactYamlLine(
  prefix: string,
  key: string,
  value: string,
  eol: string,
  listCarIdx: number | undefined,
  driverCarIdx: number | undefined,
): string | undefined {
  const label = listCarIdx === undefined ? "Driver ?" : `Driver ${listCarIdx}`;
  if (NAME_KEYS.has(key)) return `${prefix}${key}: ${label}${eol}`;
  if (key === "UserID")
    return `${prefix}${key}: ${syntheticId(SYNTHETIC_USER_ID_BASE, listCarIdx)}${eol}`;
  if (key === "DriverUserID") {
    return `${prefix}${key}: ${syntheticId(SYNTHETIC_USER_ID_BASE, driverCarIdx)}${eol}`;
  }
  if (key === "TeamID") {
    const original = value.trim();
    const id = original === "0" ? "0" : syntheticId(SYNTHETIC_TEAM_ID_BASE, listCarIdx);
    return `${prefix}${key}: ${id}${eol}`;
  }
  if (key === "TelemetryDiskFile") return `${prefix}${key}: ""${eol}`;
  return undefined;
}

function syntheticId(base: number, carIdx: number | undefined): number {
  return base + (carIdx ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Le Mans Ultimate: REST bodies and the LMU_Data mapping
// ---------------------------------------------------------------------------------------------

/** Names shorter than this are left alone: too ambiguous to find, and too short to replace. */
const MIN_NAME_LENGTH = 3;

interface RestRecordJson {
  path: string;
  body: unknown;
}

/**
 * Finds personal names in LMU REST responses and removes them from REST JSON and from the raw
 * `LMU_Data` buffer. Feed it every REST record of the whole recording with {@link observe}
 * first, because the names are known only once the first standings response has arrived.
 */
export class LmuRedactor {
  /** name -> replacement; a more specific source (higher priority) replaces a vaguer label. */
  private readonly names = new Map<string, { replacement: string; priority: number }>();
  private sortedNames: [string, string][] | undefined;
  private unmatchedCounter = 0;

  /** Names that could not be replaced inside the binary buffer (shorter than the minimum). */
  readonly skippedShortNames = new Set<string>();

  observe(rest: RestRecordJson): void {
    const body = parseNested(rest.body);
    if (rest.path === "/rest/watch/standings" && Array.isArray(body)) this.observeStandings(body);
    if (rest.path === "/rest/watch/sessionInfo" && isRecord(body)) {
      this.add(body["playerName"], "Driver player", 1);
    }
    if (rest.path === "/rest/strategy/usage" && isRecord(body)) {
      for (const name of Object.keys(body)) this.add(name, `Driver u${this.unmatchedCounter++}`, 1);
    }
    this.collectRosterNames(body);
  }

  get nameCount(): number {
    return this.names.size;
  }

  /** The original names, for verification scripts. Never log them. Team names are game content. */
  originalNames(options: { people?: boolean } = {}): string[] {
    return [...this.names.entries()]
      .filter(([, { replacement }]) => !options.people || !replacement.startsWith("Team "))
      .map(([name]) => name);
  }

  redactRestPayload(payload: Buffer): Buffer {
    const text = payload.toString("utf8");
    let out = text;
    for (const [name, replacement] of this.sorted()) {
      const escaped = JSON.stringify(name).slice(1, -1);
      out = out.split(`"${escaped}"`).join(`"${replacement}"`);
      out = out.split(`\\"${escaped}\\"`).join(`\\"${replacement}\\"`);
    }
    return Buffer.from(out, "utf8");
  }

  /** Overwrites every occurrence of a known name in place, padding with NUL bytes. */
  redactBuffer(buffer: Buffer): Buffer {
    const out = Buffer.from(buffer);
    for (const [name, replacement] of this.sorted()) {
      const target = Buffer.from(name, "utf8");
      if (target.length < MIN_NAME_LENGTH) {
        this.skippedShortNames.add(name);
        continue;
      }
      const fill = fitReplacement(replacement, target.length);
      for (let pos = out.indexOf(target); pos >= 0; pos = out.indexOf(target, pos + 1)) {
        out.fill(0, pos, pos + target.length);
        out.write(fill, pos, "latin1");
      }
    }
    return out;
  }

  private observeStandings(entries: unknown[]): void {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const slot = entry["slotID"];
      this.add(entry["driverName"], `Driver ${String(slot)}`, 3);
      this.add(entry["fullTeamName"], `Team ${String(slot)}`, 2);
    }
  }

  /** `drivers[].name` inside any body, also inside JSON embedded in a string. */
  private collectRosterNames(value: unknown): void {
    const nested = parseNested(value);
    if (Array.isArray(nested)) {
      for (const item of nested) this.collectRosterNames(item);
    } else if (isRecord(nested)) {
      for (const [key, child] of Object.entries(nested)) {
        if (key === "drivers" && Array.isArray(child)) {
          for (const d of child) {
            if (isRecord(d)) this.add(d["name"], `Driver r${this.unmatchedCounter++}`, 1);
          }
        } else {
          this.collectRosterNames(child);
        }
      }
    }
  }

  private add(name: unknown, replacement: string, priority: number): void {
    if (typeof name !== "string") return;
    for (const variant of [name, ...abbreviations(name)]) {
      if (variant.length < MIN_NAME_LENGTH) {
        if (variant === name && name.length > 0) this.skippedShortNames.add(name);
        continue;
      }
      if ((this.names.get(variant)?.priority ?? 0) >= priority) continue;
      this.names.set(variant, { replacement, priority });
      this.sortedNames = undefined;
    }
  }

  private sorted(): [string, string][] {
    this.sortedNames ??= [...this.names.entries()]
      .map(([name, { replacement }]): [string, string] => [name, replacement])
      .sort((a, b) => b[0].length - a[0].length);
    return this.sortedNames;
  }
}

/** The pit menu shows drivers as "F Last"; cover that and "F. Last" for multi-word names. */
function abbreviations(name: string): string[] {
  const [first, ...rest] = name.trim().split(/\s+/);
  if (!first || rest.length === 0) return [];
  const tail = rest.join(" ");
  return [`${first[0]} ${tail}`, `${first[0]}. ${tail}`];
}

/** A replacement that is never longer than the name it overwrites in the binary buffer. */
function fitReplacement(replacement: string, maxLength: number): string {
  if (replacement.length <= maxLength) return replacement;
  const compact = `${replacement[0] ?? "D"}${replacement.replace(/\D+/g, "")}`;
  return compact.length <= maxLength ? compact : compact.slice(0, maxLength);
}

function parseNested(value: unknown): unknown {
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
