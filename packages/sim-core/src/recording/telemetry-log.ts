import type { SimState } from "../model";
import {
  OTLM_FORMAT,
  OTLM_VERSION,
  type OtlmGroup,
  type OtlmHeader,
  type OtlmWriter,
} from "./otlm";
import { playerCar } from "./trackers";

/** Group ids of the tier 2 file. */
export const PLAYER_GROUP = "player";
export const FIELD_GROUP = "field";

export const PLAYER_RATE_HZ = 60;
export const FIELD_RATE_HZ = 4;
/** About ten seconds of samples per chunk. */
const CHUNK_SECONDS = 10;
/** Cars to make room for at least; iRacing has up to 64 slots. */
export const MIN_FIELD_SLOTS = 64;

/** A sample is taken when the nominal interval minus this slack has passed (sim clocks jitter). */
const JITTER_SLACK_S = 0.004;

/** `scale` values chosen so that the stored integers are at least as precise as the sims are. */
const LAP_PCT_SCALE = 30_000;

export function playerGroup(): OtlmGroup {
  return {
    id: PLAYER_GROUP,
    rateHz: PLAYER_RATE_HZ,
    chunkSamples: PLAYER_RATE_HZ * CHUNK_SECONDS,
    channels: [
      { name: "t", unit: "s", type: "i32", scale: 1000, delta: true },
      { name: "speed", unit: "m/s", type: "i16", scale: 100, delta: true },
      { name: "throttle", unit: "fraction", type: "i16", scale: 1000, delta: true },
      { name: "brake", unit: "fraction", type: "i16", scale: 1000, delta: true },
      { name: "clutch", unit: "fraction", type: "i16", scale: 1000, delta: true },
      {
        name: "steer",
        unit: "fraction of lock, right positive",
        type: "i16",
        scale: 1000,
        delta: true,
      },
      { name: "gear", unit: "gear, -1 reverse, 0 neutral", type: "i8" },
      { name: "rpm", unit: "rpm", type: "i16", delta: true },
      { name: "lapDistPct", unit: "fraction", type: "i16", scale: LAP_PCT_SCALE, delta: true },
      { name: "fuel", unit: "L", type: "i32", scale: 1000, delta: true },
      { name: "lap", unit: "completed laps, -1 unknown", type: "i16" },
    ],
  };
}

export function fieldGroup(slots: number): OtlmGroup {
  return {
    id: FIELD_GROUP,
    rateHz: FIELD_RATE_HZ,
    chunkSamples: FIELD_RATE_HZ * CHUNK_SECONDS,
    channels: [
      { name: "t", unit: "s", type: "i32", scale: 1000, delta: true },
      {
        name: "lapDistPct",
        unit: "fraction, per carIdx",
        type: "i16",
        scale: LAP_PCT_SCALE,
        delta: true,
        count: slots,
      },
      { name: "position", unit: "overall position, per carIdx", type: "i16", count: slots },
    ],
  };
}

export interface LogHeaderInit {
  sessionId: string;
  sim: string;
  startedAt: number;
  fieldSlots: number;
}

export function buildLogHeader(init: LogHeaderInit): OtlmHeader {
  return {
    format: OTLM_FORMAT,
    version: OTLM_VERSION,
    sessionId: init.sessionId,
    sim: init.sim,
    startedAt: init.startedAt,
    groups: [playerGroup(), fieldGroup(init.fieldSlots)],
    meta: { fieldSlots: init.fieldSlots },
  };
}

/** Number of car slots a field group needs for this state. */
export function fieldSlotsFor(state: SimState): number {
  const highest = state.cars.reduce((m, c) => Math.max(m, c.carIdx), -1);
  return Math.max(MIN_FIELD_SLOTS, highest + 1);
}

function nan(value: number | null): number {
  return value ?? NaN;
}

/**
 * Takes the player's channels at up to 60 Hz and the field's positions at up to 4 Hz from the
 * stream of states and hands them to the writer. Does no I/O itself.
 */
export class TelemetrySampler {
  private lastPlayerS: number | null = null;
  private lastFieldS: number | null = null;
  private readonly playerRow = new Float64Array(playerGroup().channels.length);
  private readonly fieldRow: Float64Array;

  constructor(
    private readonly writer: OtlmWriter,
    private readonly fieldSlots: number,
  ) {
    this.fieldRow = new Float64Array(1 + 2 * fieldSlots);
  }

  accept(state: SimState): void {
    const t = state.tickTimeS;
    if (t === null || !state.connected) return;
    if (this.due(t, this.lastPlayerS, PLAYER_RATE_HZ)) {
      this.lastPlayerS = t;
      this.writer.addSample(PLAYER_GROUP, this.playerSample(state, t));
    }
    if (this.due(t, this.lastFieldS, FIELD_RATE_HZ)) {
      this.lastFieldS = t;
      this.writer.addSample(FIELD_GROUP, this.fieldSample(state, t));
    }
  }

  /** The clock going back (a new run of the same session) always starts a new sample. */
  private due(t: number, last: number | null, rateHz: number): boolean {
    return last === null || t < last || t - last >= 1 / rateHz - JITTER_SLACK_S;
  }

  private playerSample(state: SimState, t: number): Float64Array {
    const p = state.player;
    const car = playerCar(state);
    const row = this.playerRow;
    row[0] = t;
    row[1] = nan(p.speedMps);
    row[2] = nan(p.inputs.throttle);
    row[3] = nan(p.inputs.brake);
    row[4] = nan(p.inputs.clutch);
    row[5] = nan(p.inputs.steer);
    row[6] = nan(p.gear);
    row[7] = nan(p.rpm);
    row[8] = nan(car?.lapDistPct ?? null);
    row[9] = nan(p.fuelL);
    row[10] = car?.lapsCompleted ?? -1;
    return row;
  }

  private fieldSample(state: SimState, t: number): Float64Array {
    const slots = this.fieldSlots;
    const row = this.fieldRow;
    row.fill(NaN, 1, 1 + slots);
    row.fill(0, 1 + slots);
    row[0] = t;
    for (const car of state.cars) {
      if (car.carIdx >= slots || !car.connected) continue;
      row[1 + car.carIdx] = nan(car.lapDistPct);
      row[1 + slots + car.carIdx] = car.position ?? 0;
    }
    return row;
  }
}
