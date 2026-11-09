import type { TelemetryFrame } from "@overlay/sim-core/types";

/**
 * clean: no incidents. caution: incidents, below the penalty limit. penalty: at or past the
 * penalty limit, below the DQ limit. dq: at or past the DQ limit.
 */
export type IncidentStatus = "clean" | "caution" | "penalty" | "dq";

export interface IncidentBarSegment {
  /** Share of the bar's length, 0..1. */
  share: number;
  /** How full the segment is, 0..1. */
  fill: number;
  /** "pen": the track up to the penalty limit (or the only track); "dq": penalty to DQ. */
  kind: "pen" | "dq";
}

export interface IncidentsView {
  count: number;
  /** True when the count is the team's total (team events). */
  team: boolean;
  /** The first penalty limit; null when the session sets none, or none below the DQ limit. */
  penaltyLimit: number | null;
  /** The DQ limit; null when unlimited or unknown. */
  dqLimit: number | null;
  status: IncidentStatus;
}

/** Shown in edit mode without live data: a clean race with a 17x penalty and 25x DQ limit. */
export const SAMPLE_INCIDENTS_VIEW: IncidentsView = {
  count: 0,
  team: false,
  penaltyLimit: 17,
  dqLimit: 25,
  status: "clean",
};

const limit = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) || v <= 0 ? null : Math.round(v);

const count = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Math.max(0, Math.round(v));

export function incidentStatus(
  n: number,
  penaltyLimit: number | null,
  dqLimit: number | null,
): IncidentStatus {
  if (dqLimit !== null && n >= dqLimit) return "dq";
  if (penaltyLimit !== null && n >= penaltyLimit) return "penalty";
  return n > 0 ? "caution" : "clean";
}

/**
 * The player's incidents and the session's limits; null without a live frame or a count.
 * In team events the limits apply to the team's total, so the team count is used there.
 */
export function incidentsView(frame: TelemetryFrame | null): IncidentsView | null {
  if (frame === null || frame.status !== "live") return null;
  const { player, session } = frame.state;
  const team = session.teamRacing === true && count(player.teamIncidentCount) !== null;
  const n = team ? count(player.teamIncidentCount) : count(player.incidentCount);
  if (n === null) return null;
  const dqLimit = limit(session.incidentLimit);
  const pen = limit(session.incidentPenaltyLimit);
  // A penalty limit at or past the DQ limit can never apply.
  const penaltyLimit = pen !== null && dqLimit !== null && pen >= dqLimit ? null : pen;
  return {
    count: n,
    team,
    penaltyLimit,
    dqLimit,
    status: incidentStatus(n, penaltyLimit, dqLimit),
  };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * The bar: a track from 0 to the penalty limit, then a track from there to the DQ limit. With only
 * one limit the bar is a single track up to it; with none there is no bar.
 */
export function incidentBar(view: IncidentsView): IncidentBarSegment[] {
  const { count: n, penaltyLimit: pen, dqLimit: dq } = view;
  if (pen !== null && dq !== null) {
    return [
      { kind: "pen", share: pen / dq, fill: clamp01(n / pen) },
      { kind: "dq", share: (dq - pen) / dq, fill: clamp01((n - pen) / (dq - pen)) },
    ];
  }
  const only = pen ?? dq;
  return only === null ? [] : [{ kind: "pen", share: 1, fill: clamp01(n / only) }];
}
