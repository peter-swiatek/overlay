import { RecordKind, type FixtureRecord } from "../../fixtures";
import type { FuelSample } from "./types";

/** Synthetic driver: steps of 10% of a lap, burning `burnPerLap` litres per lap. */
export class FakeDriver {
  sessionTimeS = 0;
  lap = 0;
  pct = 0;
  fuelL: number;
  onPitRoad = false;
  inPitStall = false;
  isPaceLap = false;
  sessionNum = 0;

  constructor(
    startFuelL: number,
    private readonly burnPerLap: number,
  ) {
    this.fuelL = startFuelL;
  }

  sample(): FuelSample {
    return {
      sessionTimeS: this.sessionTimeS,
      sessionNum: this.sessionNum,
      sessionState: this.isPaceLap ? 3 : 4,
      lap: this.lap,
      lapDistPct: this.pct,
      fuelL: this.fuelL,
      onPitRoad: this.onPitRoad,
      inPitStall: this.inPitStall,
      isPaceLap: this.isPaceLap,
      sessionType: "Race",
    };
  }

  /** Advance one 10% step; the counter ticks with the wrap unless `counterLag` defers it by a tick. */
  step(counterLag = false): FuelSample {
    this.sessionTimeS += 1;
    this.fuelL -= this.burnPerLap / 10;
    this.pct += 0.1;
    // Land clearly beyond the wrap detector's "high" mark, as a real 60 Hz stream would.
    if (this.pct > 0.85 && this.pct < 0.95) this.pct = 0.901;
    if (this.pct > 0.999) {
      this.pct = 0;
      if (!counterLag) this.lap += 1;
      else this.pendingLap = true;
    } else if (this.pendingLap) {
      this.lap += 1;
      this.pendingLap = false;
    }
    return this.sample();
  }

  private pendingLap = false;
}

export function feed(
  tracker: { update(s: FuelSample): void },
  driver: FakeDriver,
  laps: number,
  counterLag = false,
): void {
  tracker.update(driver.sample());
  for (let i = 0; i < laps * 10; i++) tracker.update(driver.step(counterLag));
  // Let a deferred counter tick land.
  if (counterLag) tracker.update(driver.step(false));
}

// ---- Minimal irsdk var decoder for the local-recording check ------------------------------

const VAR_HEADER_BYTES = 144;

export type VarType = "char" | "bool" | "int" | "bitfield" | "float" | "double";
const TYPE_NAMES: VarType[] = ["char", "bool", "int", "bitfield", "float", "double"];

export interface VarDef {
  type: VarType;
  offset: number;
  count: number;
  name: string;
}

export function parseVarHeaders(payload: Buffer): Map<string, VarDef> {
  const numVars = payload.readInt32LE(24);
  const varHeaderOffset = payload.readInt32LE(28);
  const out = new Map<string, VarDef>();
  for (let i = 0; i < numVars; i++) {
    const base = varHeaderOffset + i * VAR_HEADER_BYTES;
    const type = TYPE_NAMES[payload.readInt32LE(base)];
    if (type === undefined) continue;
    const nameBytes = payload.subarray(base + 16, base + 48);
    const end = nameBytes.indexOf(0);
    const name = nameBytes.subarray(0, end < 0 ? 32 : end).toString("latin1");
    out.set(name, {
      type,
      offset: payload.readInt32LE(base + 4),
      count: payload.readInt32LE(base + 8),
      name,
    });
  }
  return out;
}

/** Reads element 0 of a variable from a kind-4 payload (4-byte tick, then the var buffer). */
export function readVar(payload: Buffer, def: VarDef): number {
  const at = 4 + def.offset;
  switch (def.type) {
    case "char":
    case "bool":
      return payload.readUInt8(at);
    case "int":
    case "bitfield":
      return payload.readInt32LE(at);
    case "float":
      return payload.readFloatLE(at);
    case "double":
      return payload.readDoubleLE(at);
  }
}

export const FUEL_FIXTURE_VARS = [
  "FuelLevel",
  "Lap",
  "LapCompleted",
  "LapDistPct",
  "OnPitRoad",
  "PlayerCarInPitStall",
  "SessionNum",
  "SessionState",
  "SessionTime",
] as const;

/**
 * Turns a record stream into fuel samples. Call `accept` per record; it returns a sample for each
 * var buffer once the header record has been seen. `Lap`/`LapCompleted` are both decoded; the
 * completed-laps counter drives the tracker. Session types are not parsed from the YAML here.
 */
export class IracingFuelSampler {
  private defs: Map<string, VarDef> | null = null;

  accept(record: FixtureRecord, sessionTypeFor: (sessionNum: number) => string): FuelSample | null {
    if (record.kind === RecordKind.IracingHeader) {
      this.defs = parseVarHeaders(record.payload);
      return null;
    }
    if (record.kind !== RecordKind.IracingVarBuffer || this.defs === null) return null;
    const v = (name: string): number => {
      const def = this.defs?.get(name);
      if (def === undefined) throw new Error(`Recording lacks variable ${name}`);
      return readVar(record.payload, def);
    };
    const sessionNum = v("SessionNum");
    const sessionState = v("SessionState");
    return {
      sessionTimeS: v("SessionTime"),
      sessionNum,
      sessionState,
      lap: v("LapCompleted"),
      lapDistPct: v("LapDistPct"),
      fuelL: v("FuelLevel"),
      onPitRoad: v("OnPitRoad") !== 0,
      inPitStall: v("PlayerCarInPitStall") !== 0,
      isPaceLap: sessionState === 3,
      sessionType: sessionTypeFor(sessionNum),
    };
  }
}
