/**
 * LMU publishes the sector a car is in (scoring `sector`: 1 = sector 1, 2 = sector 2, 0 = sector 3)
 * but not where the sectors start. The learner watches the player's car and records the lap
 * fraction at which the sector changes, and reports the three sector starts once both inner
 * boundaries have been seen on this track. In memory only; a new track starts over.
 */

/** A sector change only counts when the car moved forward less than this since the last sample. */
const MAX_STEP_PCT = 0.02;

/** 0-based sector index from the scoring byte (0 means the third sector); null for anything else. */
export function lmuSectorIndex(raw: number): number | null {
  switch (raw) {
    case 1:
      return 0;
    case 2:
      return 1;
    case 0:
      return 2;
    default:
      return null;
  }
}

export class LmuSectorLearner {
  private trackKey: string | null = null;
  private readonly starts: [number | null, number | null] = [null, null];
  private prevIndex: number | null = null;
  private prevPct: number | null = null;

  /**
   * One frame of the player's car. `trackKey` identifies the layout (a change forgets what was
   * learned); `rawSector` is the scoring byte; `lapDistPct` the lap fraction (null when unknown).
   * Returns the sector starts (`[0, s2, s3]`) once known, else null.
   */
  observe(trackKey: string | null, rawSector: number, lapDistPct: number | null): number[] | null {
    if (trackKey !== this.trackKey) {
      this.trackKey = trackKey;
      this.starts[0] = null;
      this.starts[1] = null;
      this.prevIndex = null;
      this.prevPct = null;
    }
    const index = lmuSectorIndex(rawSector);
    if (trackKey === null || index === null || lapDistPct === null) {
      this.prevIndex = null;
      this.prevPct = null;
      return this.current();
    }
    const prevIndex = this.prevIndex;
    const prevPct = this.prevPct;
    if (prevIndex !== null && prevPct !== null && index === prevIndex + 1 && index >= 1) {
      const step = lapDistPct - prevPct;
      // The boundary lies between the two samples; a teleport or a tow does not count.
      if (step > 0 && step < MAX_STEP_PCT) this.starts[index - 1] = (prevPct + lapDistPct) / 2;
    }
    this.prevIndex = index;
    this.prevPct = lapDistPct;
    return this.current();
  }

  private current(): number[] | null {
    const [s2, s3] = this.starts;
    if (s2 === null || s3 === null || !(s2 > 0 && s2 < s3 && s3 < 1)) return null;
    return [0, s2, s3];
  }
}
