import type { Car, TelemetryFrame } from "@overlay/sim-core/types";

/** Cars shown on each side of the player in the relative table. */
export const RELATIVE_SIDE_COUNT = 3;

export interface RelativeRow {
  carIdx: number;
  isPlayer: boolean;
  position: number | null;
  carNumber: string;
  name: string;
  classColour: string | null;
  /** Seconds relative to the player: negative = ahead, null = unavailable or the player. */
  gapS: number | null;
  lastLapS: number | null;
}

/** What an overlay shows instead of data, or null when the frame is live. */
export function statusNotice(frame: TelemetryFrame | null): string | null {
  if (frame === null || frame.status === "waiting") return "Waiting for sim";
  if (frame.status === "error") return frame.error ?? "Telemetry error";
  return null;
}

function rowOf(car: Car, isPlayer: boolean, gapS: number | null): RelativeRow {
  return {
    carIdx: car.carIdx,
    isPlayer,
    position: car.position,
    carNumber: car.carNumber ?? "",
    name: car.driverName ?? `Car ${car.carIdx}`,
    classColour: car.classColour,
    gapS,
    lastLapS: car.lastLapS,
  };
}

/**
 * Up to three cars ahead, the player and up to three behind (furthest ahead first). Gaps come
 * from `derived.gaps`; cars without a gap are left out. Empty unless the frame is live.
 */
export function relativeRows(frame: TelemetryFrame | null): RelativeRow[] {
  if (frame === null || frame.status !== "live") return [];
  const { state, derived } = frame;
  const byIdx = new Map(state.cars.map((car) => [car.carIdx, car]));
  const known = derived.gaps.flatMap((gap) => {
    const car = byIdx.get(gap.carIdx);
    return car && gap.gapS !== null ? [{ car, gapS: gap.gapS }] : [];
  });
  const ahead = known
    .filter((e) => e.gapS < 0)
    .sort((a, b) => b.gapS - a.gapS)
    .slice(0, RELATIVE_SIDE_COUNT)
    .reverse();
  const behind = known
    .filter((e) => e.gapS >= 0)
    .sort((a, b) => a.gapS - b.gapS)
    .slice(0, RELATIVE_SIDE_COUNT);
  const player = state.playerCarIdx === null ? undefined : byIdx.get(state.playerCarIdx);
  return [
    ...ahead.map((e) => rowOf(e.car, false, e.gapS)),
    ...(player ? [rowOf(player, true, null)] : []),
    ...behind.map((e) => rowOf(e.car, false, e.gapS)),
  ];
}

export interface InputsView {
  /** 0..1, except steer (-1..1). */
  throttle: number;
  brake: number;
  clutch: number;
  steer: number;
  /** -1 reverse, 0 neutral, 1..n. */
  gear: number;
  speedKph: number;
}

const ZERO_INPUTS: InputsView = {
  throttle: 0,
  brake: 0,
  clutch: 0,
  steer: 0,
  gear: 0,
  speedKph: 0,
};

const clamp = (v: number | null, lo: number, hi: number): number =>
  v === null || !Number.isFinite(v) ? 0 : Math.min(hi, Math.max(lo, v));

/** Player inputs; all zero unless the frame is live. */
export function inputsView(frame: TelemetryFrame | null): InputsView {
  if (frame === null || frame.status !== "live") return ZERO_INPUTS;
  const { inputs, gear, speedMps } = frame.state.player;
  return {
    throttle: clamp(inputs.throttle, 0, 1),
    brake: clamp(inputs.brake, 0, 1),
    clutch: clamp(inputs.clutch, 0, 1),
    steer: clamp(inputs.steer, -1, 1),
    gear: Math.round(clamp(gear, -1, 20)),
    speedKph: clamp(speedMps, 0, 200) * 3.6,
  };
}

/** "-0.8" for a car ahead, "+1.3" for one behind, "-" when there is no gap. */
export function formatGap(gapS: number | null): string {
  if (gapS === null) return "-";
  return `${gapS < 0 ? "-" : "+"}${Math.abs(gapS).toFixed(1)}`;
}

export function formatLap(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "-";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

export function formatGear(gear: number): string {
  return gear < 0 ? "R" : gear === 0 ? "N" : String(gear);
}
