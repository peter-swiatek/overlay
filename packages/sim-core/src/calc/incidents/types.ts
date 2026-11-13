/** Events kept in {@link IncidentLog.events}. */
export const INCIDENT_LOG_MAX = 50;

/**
 * What happened. With incident points (the player in iRacing) the kind follows the points:
 * 1x off track, 2x loss of control, 4x contact, any other amount "incident". Without points it
 * comes from the car's track surface ("off-track").
 */
export type IncidentLogKind = "off-track" | "loss-of-control" | "contact" | "incident";

/** One logged event. Plain data; `id` is unique and increasing within a session. */
export interface IncidentLogEvent {
  id: number;
  carIdx: number;
  carNumber: string | null;
  driverName: string | null;
  /** Session time when it happened, seconds. */
  timeS: number;
  /** Lap the car was on (lapsCompleted + 1); null when unknown. */
  lap: number | null;
  /** 1-based official sector the car was in; null without sector data. */
  sector: number | null;
  /** Number of the corner the car was in (our own corner list, not official turn numbers); null when none. */
  corner: number | null;
  kind: IncidentLogKind;
  /**
   * Incident points (iRacing, the player's own count). Null when the sim gives none for this
   * event: other cars' off-tracks, and every event in sims without incident points.
   */
  points: number | null;
  /** The event is the player's. */
  own: boolean;
}

/** Published as Derived.incidentLog. */
export interface IncidentLog {
  /** Newest first, at most {@link INCIDENT_LOG_MAX}. */
  events: readonly IncidentLogEvent[];
}
