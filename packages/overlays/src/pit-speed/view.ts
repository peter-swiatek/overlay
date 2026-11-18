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
  /** speed / limit clamped 0..1 for the bar; null without a limit or speed. */
  fillFraction: number | null;
  limiterOn: boolean | null;
  /** Metres to the pit box along the lap, only while on pit road; null otherwise. */
  distanceToBoxM: number | null;
  inPitStall: boolean;
}

// The reference gives no numbers for either of these; they are our choices.
/** Speed above the limit (m/s) that still counts as "under", so a held limit does not flicker. */
export const OVER_TOLERANCE_MPS = 0.3;

const round = (v: number, step: number): number => Math.round(v / step) * step;
const finite = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v;

const INACTIVE: PitSpeedView = {
  active: false,
  speedMps: null,
  limitMps: null,
  overMps: null,
  state: null,
  fillFraction: null,
  limiterOn: null,
  distanceToBoxM: null,
  inPitStall: false,
};

/** On pit road at 59 of 60 km/h; shown in edit mode when the overlay is not active. */
export const EDIT_SAMPLE: PitSpeedView = {
  active: true,
  speedMps: 16.4,
  limitMps: 16.7,
  overMps: -0.3,
  state: "under",
  fillFraction: 0.98,
  limiterOn: true,
  distanceToBoxM: 120,
  inPitStall: false,
};

/**
 * Distance to the player's pit box. No reference formula: we take the forward lap-fraction
 * difference (wrapped over the S/F line) times the track length. It is shown whenever the car
 * is on pit road and the box position is known (no reference cutoff).
 */
function distanceToBox(
  onPitRoad: boolean,
  boxPct: number | null,
  carPct: number | null,
  trackLengthM: number | null,
): number | null {
  if (!onPitRoad || boxPct === null || carPct === null || trackLengthM === null) return null;
  const ahead = (boxPct - carPct + 1) % 1;
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
    fillFraction:
      rawSpeed === null || limitMps === null || limitMps <= 0
        ? null
        : round(Math.max(0, Math.min(1, rawSpeed / limitMps)), 0.01),
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
