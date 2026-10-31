import type { TelemetryFrame } from "@overlay/sim-core/types";

export interface PitSpeedView {
  /** False outside pit road with the limiter off (the overlay renders nothing unless editing). */
  active: boolean;
  speedMps: number | null;
  limitMps: number | null;
  /** speed - limit, m/s; null when either is unknown. */
  overMps: number | null;
  /** "over" above the limit (+0.3 m/s tolerance), "under" otherwise; null without a limit. */
  state: "over" | "under" | null;
  /** -1..1: bar fill, 0 = exactly the limit, +-1 = +-20 % of the limit; null without a limit. */
  barPosition: number | null;
  limiterOn: boolean | null;
  /** Metres to the pit box along the lap, only while on pit road before the box; null otherwise. */
  distanceToBoxM: number | null;
  inPitStall: boolean;
}

// The reference gives no numbers for either of these; they are our choices.
/** Speed above the limit (m/s) that still counts as "under", so a held limit does not flicker. */
export const OVER_TOLERANCE_MPS = 0.3;
/** Share of the limit at which the bar is full on either side. */
export const BAR_SCALE = 0.2;

const round = (v: number, step: number): number => Math.round(v / step) * step;
const finite = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

const INACTIVE: PitSpeedView = {
  active: false,
  speedMps: null,
  limitMps: null,
  overMps: null,
  state: null,
  barPosition: null,
  limiterOn: null,
  distanceToBoxM: null,
  inPitStall: false,
};

/** On pit road at 78 km/h against 80; shown in edit mode when the overlay is not active. */
export const EDIT_SAMPLE: PitSpeedView = {
  active: true,
  speedMps: 21.7,
  limitMps: 22.2,
  overMps: -0.5,
  state: "under",
  barPosition: -0.11,
  limiterOn: true,
  distanceToBoxM: 120,
  inPitStall: false,
};

/**
 * Distance to the player's pit box. The reference gives no formula: we take the forward lap-fraction
 * difference (wrapped over the S/F line) times the track length, and treat anything beyond half
 * a lap as "the box is behind us".
 */
function distanceToBox(
  onPitRoad: boolean,
  boxPct: number | null,
  carPct: number | null,
  trackLengthM: number | null,
): number | null {
  if (!onPitRoad || boxPct === null || carPct === null || trackLengthM === null) return null;
  const ahead = (boxPct - carPct + 1) % 1;
  if (!(ahead < 0.5)) return null;
  return Math.round(ahead * trackLengthM);
}

export function pitSpeedView(frame: TelemetryFrame | null): PitSpeedView {
  if (frame === null || frame.status !== "live") return INACTIVE;
  const { state } = frame;
  const { player, session } = state;
  const car =
    state.playerCarIdx === null
      ? undefined
      : state.cars.find((c) => c.carIdx === state.playerCarIdx);
  const onPitRoad = car?.onPitRoad === true;
  if (!onPitRoad && player.pitLimiter !== true) return INACTIVE;

  const rawSpeed = finite(player.speedMps);
  const limit = finite(session.pitSpeedLimitMps);
  const limitMps = limit !== null && limit > 0 ? limit : null;
  const diff = rawSpeed !== null && limitMps !== null ? rawSpeed - limitMps : null;
  return {
    active: true,
    speedMps: rawSpeed === null ? null : round(rawSpeed, 0.1),
    limitMps,
    overMps: diff === null ? null : round(diff, 0.1),
    state: diff === null ? null : diff > OVER_TOLERANCE_MPS ? "over" : "under",
    barPosition:
      diff === null || limitMps === null
        ? null
        : round(Math.max(-1, Math.min(1, diff / (limitMps * BAR_SCALE))), 0.01),
    limiterOn: player.pitLimiter,
    distanceToBoxM: distanceToBox(
      onPitRoad,
      finite(player.pitStallLapDistPct),
      finite(car?.lapDistPct),
      finite(session.trackLengthM),
    ),
    inPitStall: car?.inPitStall === true,
  };
}
