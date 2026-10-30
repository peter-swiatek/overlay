export type LiveSim = "iracing" | "lmu";

/** How long the current sim may be not live before another one is tried. */
export const SWITCH_AFTER_MS = 5000;
/** How often the sims are checked. */
export const DETECT_INTERVAL_MS = 1000;

/**
 * Chooses which sim to read. Keeps the current sim while it is live; once it has been not live
 * for 5 s, switches to the first live sim in `order` (iRacing before LMU), or to none.
 * Pure: the caller supplies the time and each sim's liveness.
 */
export class AutoSelector {
  private current: LiveSim | null = null;
  private notLiveSince: number | null = null;

  constructor(private readonly order: readonly LiveSim[] = ["iracing", "lmu"]) {}

  get selected(): LiveSim | null {
    return this.current;
  }

  /** `isLive` is called only for the sims that matter for this decision. */
  update(nowMs: number, isLive: (sim: LiveSim) => boolean): LiveSim | null {
    if (this.current !== null) {
      if (isLive(this.current)) {
        this.notLiveSince = null;
        return this.current;
      }
      this.notLiveSince ??= nowMs;
      if (nowMs - this.notLiveSince < SWITCH_AFTER_MS) return this.current;
      this.current = null;
      this.notLiveSince = null;
    }
    this.current = this.order.find((sim) => isLive(sim)) ?? null;
    return this.current;
  }

  reset(): void {
    this.current = null;
    this.notLiveSince = null;
  }
}
