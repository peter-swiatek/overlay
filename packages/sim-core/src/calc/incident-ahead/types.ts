/** How far ahead the Deriver looks for an incident, metres. Overlays narrow it further. */
export const INCIDENT_AHEAD_RANGE_M = 1000;

/**
 * What the car ahead is doing: "off" off track (iRacing only, from its track surface),
 * "stopped" on track below the stopped speed, "slow" on track below the slow speed.
 */
export type IncidentAheadKind = "off" | "slow" | "stopped";

/** The nearest incident ahead of the player on track. Published as Derived.incidentAhead. */
export interface IncidentAhead {
  carIdx: number;
  carNumber: string | null;
  /** Metres along the track from the player to that car, 0..INCIDENT_AHEAD_RANGE_M. */
  distanceM: number;
  kind: IncidentAheadKind;
  /** The car is (nearly) standing still, whether on or off track. */
  stopped: boolean;
  /** Number of the corner it is in (our own corner list); null when none. */
  corner: number | null;
}
