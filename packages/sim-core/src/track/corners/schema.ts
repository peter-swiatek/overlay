/**
 * One corner as a stretch of the lap. `startPct` is where the car starts to turn in, `endPct`
 * where it is back on a straight; both are lapDistPct in 0..1. A corner that spans the start/finish
 * line has endPct < startPct.
 */
export interface Corner {
  /** 1-based, in driving order from the start/finish line. */
  number: number;
  /** Only where it is a public fact; absent otherwise. */
  name?: string;
  startPct: number;
  endPct: number;
}

/**
 * A corner list for one track layout. `status: "derived"` means the ranges come from our own
 * measurements (`evidence`), not from a published source or a survey; they are good enough to
 * label a map or a lap table but not an authority on where a corner officially begins.
 */
export interface CornerList {
  version: 1;
  trackKey: string;
  trackName: string;
  status: "derived";
  /** What the ranges were measured from and how, in plain words. */
  evidence: string;
  corners: Corner[];
}

/** Throws a descriptive error for a list that breaks the schema; returns it typed otherwise. */
export function parseCornerList(value: unknown): CornerList {
  if (typeof value !== "object" || value === null) throw new Error("corner list: not an object");
  const v = value as Record<string, unknown>;
  if (v["version"] !== 1) throw new Error("corner list: version must be 1");
  if (v["status"] !== "derived") throw new Error("corner list: status must be 'derived'");
  for (const key of ["trackKey", "trackName", "evidence"]) {
    if (typeof v[key] !== "string" || v[key] === "") throw new Error(`corner list: ${key}`);
  }
  const corners = v["corners"];
  if (!Array.isArray(corners)) throw new Error("corner list: corners must be an array");
  corners.forEach((c, i) => checkCorner(c, i));
  return value as CornerList;
}

function checkCorner(value: unknown, index: number): void {
  const c = value as Record<string, unknown> | null;
  const where = `corner ${index + 1}`;
  if (typeof c !== "object" || c === null) throw new Error(`${where}: not an object`);
  if (c["number"] !== index + 1) throw new Error(`${where}: number must be ${index + 1}`);
  if (c["name"] !== undefined && (typeof c["name"] !== "string" || c["name"] === "")) {
    throw new Error(`${where}: name`);
  }
  for (const key of ["startPct", "endPct"]) {
    const n = c[key];
    if (typeof n !== "number" || !(n >= 0 && n <= 1))
      throw new Error(`${where}: ${key} not in 0..1`);
  }
}
