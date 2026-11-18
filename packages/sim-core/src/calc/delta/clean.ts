import type { TrackSurface } from "../../model/sim-state";

export interface CleanSample {
  incidentCount: number | null;
  trackSurface: TrackSurface | null;
  onPitRoad: boolean;
  inPitStall: boolean;
}

/** Tracks whether the current lap is clean (plan decision 13). */
export class LapCleanliness {
  private baseIncidents: number | null = null;
  private incidentRise = false;
  private wasOffTrack = false;
  private pit = false;
  private out = false;

  /** Lap start: remembers the incident count and whether the lap starts on pit road / in the stall. */
  start(first: CleanSample): void {
    this.baseIncidents = first.incidentCount;
    this.incidentRise = false;
    this.wasOffTrack = false;
    this.out = first.onPitRoad || first.inPitStall;
    this.pit = this.out;
    this.sample(first);
  }

  sample(s: CleanSample): void {
    if (s.incidentCount !== null) {
      if (this.baseIncidents === null || s.incidentCount < this.baseIncidents) {
        this.baseIncidents = s.incidentCount;
      } else if (s.incidentCount > this.baseIncidents) {
        this.incidentRise = true;
      }
    }
    if (s.trackSurface === "offTrack") this.wasOffTrack = true;
    if (s.onPitRoad || s.inPitStall) this.pit = true;
  }

  /** No incident rise, never off track, never on pit road or in the stall. */
  get clean(): boolean {
    return !this.incidentRise && !this.wasOffTrack && !this.pit;
  }

  /** The lap started on pit road or in the stall. */
  get outLap(): boolean {
    return this.out;
  }

  get touchedPitRoad(): boolean {
    return this.pit;
  }
}
